const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const Peer = require('peer').PeerServer;
const { v4: uuidv4 } = require('uuid');

// Налаштування PeerServer
const peerServer = Peer({ port: 9000, path: '/peer' });
peerServer.on('connection', (client) => {
  console.log('[Server] PeerJS client connected:', client.id);
});
peerServer.on('disconnect', (client) => {
  console.log('[Server] PeerJS client disconnected:', client.id);
});

// Статичні файли
app.use(express.static(path.join(__dirname, '../public')));
app.use('/student', express.static(path.join(__dirname, '../client/student')));
app.use('/teacher', express.static(path.join(__dirname, '../client/teacher')));
app.use('/conference', express.static(path.join(__dirname, '../client/conference')));

// Логи
const logEvent = (event) => {
  const log = { timestamp: new Date().toISOString(), ...event };
  fs.appendFileSync(path.join(__dirname, 'logs.json'), JSON.stringify(log) + '\n');
};

// Зберігання конференцій
let conferences = {};

app.get('/teacher', (req, res) => {
  console.log('[Server] Serving /teacher');
  res.sendFile(path.join(__dirname, '../client/teacher/index.html'));
});

app.get('/student', (req, res) => {
  console.log('[Server] Serving /student');
  res.sendFile(path.join(__dirname, '../client/student/index.html'));
});

app.get('/create-conference', (req, res) => {
  const teacherName = req.query.teacherName;
  console.log('[Server] Received /create-conference request with teacherName:', teacherName);
  if (!teacherName) {
    console.log('[Server] Error: teacherName is empty');
    return res.status(400).json({ error: 'Teacher name is required' });
  }

  const confId = uuidv4();
  console.log('[Server] Generated conference ID:', confId);
  conferences[confId] = {
    teacher: { id: confId, name: teacherName, socketId: null },
    students: {},
  };
  logEvent({ type: 'conferenceCreated', confId, teacherName });

  console.log('[Server] Redirecting to /conference/', confId);
  res.redirect(`/conference/${confId}`);
});

app.get('/join-conference', (req, res) => {
  const { confId, studentName } = req.query;
  console.log('[Server] Received /join-conference request with confId:', confId, 'studentName:', studentName);
  if (!confId || !studentName) {
    console.log('[Server] Error: confId or studentName is empty');
    return res.status(400).json({ error: 'Conference ID and student name are required' });
  }

  if (!conferences[confId]) {
    console.log('[Server] Error: Conference', confId, 'does not exist');
    return res.status(404).json({ error: 'Conference does not exist' });
  }

  console.log('[Server] Redirecting to /conference/', confId);
  res.redirect(`/conference/${confId}?studentName=${encodeURIComponent(studentName)}`);
});

app.get('/conference/:confId', (req, res) => {
  console.log('[Server] Serving /conference/', req.params.confId);
  res.sendFile(path.join(__dirname, '../client/conference/index.html'));
});

io.on('connection', (socket) => {
  console.log('[Server] User connected:', socket.id);

  socket.on('join-room', ({ confId, userId, userName, role }) => {
    console.log('[Server] Received join-room event:', { confId, userId, userName, role });
    if (!conferences[confId]) {
      console.log('[Server] Error: Conference', confId, 'does not exist');
      socket.emit('error', { message: 'Конференція не існує' });
      return;
    }

    socket.join(confId);
    console.log('[Server] Socket', socket.id, 'joined room', confId);

    if (role === 'teacher') {
      conferences[confId].teacher.socketId = socket.id;
      conferences[confId].teacher.id = userId; // Store the teacher's peer ID
      console.log('[Server] Teacher', userName, 'joined room', confId, 'with peer ID', userId);

      // Notify all students that teacher has joined
      socket.to(confId).emit('teacherJoined', { teacherId: userId });
    } else {
      const studentId = userId;
      conferences[confId].students[studentId] = {
        name: userName,
        socketId: socket.id,
        attention: 'unknown',
        emotion: 'neutral',
        camera: 'on',
        response: false
      };
      console.log('[Server] Student', userName, 'joined room', confId, 'with peer ID', userId);

      // Send updated student list to teacher
      if (conferences[confId].teacher.socketId) {
        io.to(conferences[confId].teacher.socketId).emit('updateStudentList', conferences[confId].students);
      }

      logEvent({ type: 'studentJoined', confId, studentId, studentName: userName });
    }

    // Emit user-connected event with the peer ID
    socket.to(confId).emit('user-connected', userId);

    // Send conference data to the client
    socket.emit('conferenceData', { 
      confId, 
      teacherId: conferences[confId].teacher.id,
      students: Object.keys(conferences[confId].students).map(id => ({
        id,
        name: conferences[confId].students[id].name
      }))
    });
  });

  socket.on('requestTeacherStream', ({ confId, userId }) => {
    console.log('[Server] Received requestTeacherStream for student', userId, 'in conf', confId);
    if (conferences[confId] && conferences[confId].teacher.socketId) {
      console.log('[Server] Forwarding request to teacher', conferences[confId].teacher.socketId);
      io.to(conferences[confId].teacher.socketId).emit('callStudent', { confId, studentId: userId });
    } else {
      console.log('[Server] Teacher not found for conference', confId);
      socket.emit('error', { message: 'Викладач не підключений' });
    }
  });

  socket.on('studentState', ({ confId, studentId, attention, emotion, camera }) => {
    console.log('[Server] Received studentState:', { confId, studentId, attention, emotion, camera });
    if (conferences[confId] && conferences[confId].students[studentId]) {
      conferences[confId].students[studentId] = {
        ...conferences[confId].students[studentId],
        attention,
        emotion,
        camera,
      };
      logEvent({ type: 'stateUpdate', confId, studentId, attention, emotion, camera });
      io.to(conferences[confId].teacher.socketId).emit('updateState', { studentId, ...conferences[confId].students[studentId] });
    }
  });

  socket.on('feelBad', ({ confId, studentId }) => {
    console.log('[Server] Received feelBad from student', studentId, 'in conf', confId);
    if (conferences[confId]) {
      logEvent({ type: 'feelBad', confId, studentId });
      io.to(conferences[confId].teacher.socketId).emit('alert', { message: `${conferences[confId].students[studentId].name} погано почувається` });
    }
  });

  socket.on('attentionTest', ({ confId }) => {
    console.log('[Server] Received attentionTest for conf', confId);
    if (conferences[confId]) {
      logEvent({ type: 'attentionTest', confId });
      io.to(confId).emit('startAttentionTest', { confId });
    }
  });

  socket.on('requestAction', ({ confId, action }) => {
    console.log('[Server] Received requestAction:', { confId, action });
    if (conferences[confId]) {
      logEvent({ type: 'requestAction', confId, action });
      io.to(confId).emit('performAction', { confId, action });
    }
  });

  socket.on('callStudent', ({ confId, studentId }) => {
    console.log('[Server] Received callStudent for student', studentId, 'in conf', confId);
    if (conferences[confId] && conferences[confId].students[studentId]) {
      logEvent({ type: 'callStudent', confId, studentId });
      io.to(conferences[confId].students[studentId].socketId).emit('callStudent', { confId, studentId });
      setTimeout(() => {
        if (conferences[confId] && conferences[confId].students[studentId] && !conferences[confId].students[studentId].response) {
          logEvent({ type: 'noResponse', confId, studentId });
          io.to(conferences[confId].teacher.socketId).emit('noResponse', { studentId });
        }
      }, 10000);
    }
  });

  socket.on('studentResponse', ({ confId, studentId }) => {
    console.log('[Server] Received studentResponse from student', studentId, 'in conf', confId);
    if (conferences[confId]) {
      conferences[confId].students[studentId].response = true;
      logEvent({ type: 'studentResponse', confId, studentId });
      io.to(conferences[confId].teacher.socketId).emit('studentResponse', { studentId });
    }
  });

  socket.on('shareScreen', ({ confId }) => {
    console.log('[Server] Received shareScreen for conf', confId);
    if (conferences[confId] && conferences[confId].teacher.socketId === socket.id) {
      io.to(confId).emit('screenShared', { confId });
      logEvent({ type: 'screenShared', confId });
    }
  });

  socket.on('screenShareEnded', ({ confId }) => {
    console.log('[Server] Received screenShareEnded for conf', confId);
    if (conferences[confId]) {
      io.to(confId).emit('screenShareEnded', { confId });
      logEvent({ type: 'screenShareEnded', confId });
    }
  });

  socket.on('muteMic', ({ confId, userId }) => {
    console.log('[Server] Received muteMic for user', userId, 'in conf', confId);
    socket.to(confId).emit('userMutedMic', userId);
  });

  socket.on('muteVideo', ({ confId, userId }) => {
    console.log('[Server] Received muteVideo for user', userId, 'in conf', confId);
    socket.to(confId).emit('userMutedVideo', userId);
  });

  socket.on('disconnect', () => {
    console.log('[Server] User disconnected:', socket.id);
    for (const confId in conferences) {
      const conf = conferences[confId];
      if (conf.teacher && conf.teacher.socketId === socket.id) {
        io.to(confId).emit('conferenceEnded');
        logEvent({ type: 'conferenceEnded', confId });
        delete conferences[confId];
      } else {
        for (const studentId in conf.students) {
          if (conf.students[studentId].socketId === socket.id) {
            conf.students[studentId].camera = 'off';
            logEvent({ type: 'studentDisconnected', confId, studentId });
            io.to(conf.teacher.socketId).emit('updateState', { studentId, ...conf.students[studentId] });
            io.to(conf.teacher.socketId).emit('updateStudentList', conf.students);
            socket.to(confId).emit('user-disconnected', studentId);
            delete conf.students[studentId];
            break;
          }
        }
        if (Object.keys(conf.students).length === 0 && !conf.teacher.socketId) {
          delete conferences[confId];
          console.log('[Server] Conference', confId, 'cleared due to no participants');
          logEvent({ type: 'conferenceCleared', confId });
        }
      }
    }
  });
});

setInterval(() => {
  console.log('[Server] Checking for empty conferences at', new Date().toLocaleTimeString());
  for (const confId in conferences) {
    const conf = conferences[confId];
    if (!conf.teacher.socketId && Object.keys(conf.students).length === 0) {
      delete conferences[confId];
      console.log('[Server] Conference', confId, 'cleared due to no participants');
      logEvent({ type: 'conferenceCleared', confId });
    }
  }
}, 30000);

process.on('SIGINT', () => {
  console.log('[Server] Shutting down...');
  for (const confId in conferences) {
    io.to(confId).emit('conferenceEnded');
    logEvent({ type: 'serverShutdown', confId });
  }
  conferences = {};
  process.exit(0);
});

http.listen(3000, () => console.log('Server running on port 3000'));