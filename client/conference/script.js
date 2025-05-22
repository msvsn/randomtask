console.log('[Conference] Initializing conference client...');

const socket = io('http://localhost:3000', { transports: ['websocket'] });
const peer = new Peer(undefined, { host: 'localhost', port: 9000, path: '/peer' });

const confIdDisplay = document.getElementById('confIdDisplay');
const studentVideos = document.getElementById('studentVideos');
const studentTable = document.querySelector('#studentTable tbody');
const eventLog = document.getElementById('eventLog');
const teacherPanel = document.getElementById('teacherPanel');
const studentPanel = document.getElementById('studentPanel');
const loadingMessage = document.getElementById('loadingMessage');

// Елементи для викладача
const teacherVideo = document.getElementById('teacher_teacherVideo');
const teacherScreen = document.getElementById('teacher_teacherScreen');
const teacherMuteMicButton = document.getElementById('teacher_muteMicButton');
const teacherMuteVideoButton = document.getElementById('teacher_muteVideoButton');
const teacherShareScreenButton = document.getElementById('teacher_shareScreenButton');
const teacherAttentionTestButton = document.getElementById('teacher_attentionTestButton');
const teacherLeaveButton = document.getElementById('teacher_leaveButton');

// Елементи для студента
const studentSelfVideo = document.createElement('video');
studentSelfVideo.id = 'student_selfVideo';
studentSelfVideo.autoplay = true;
const studentSelfVideoContainer = document.querySelector('.student-self-video');
studentSelfVideoContainer.appendChild(studentSelfVideo);

const studentTeacherVideo = document.getElementById('student_teacherVideo');
const studentTeacherScreen = document.getElementById('student_teacherScreen');
const studentMuteMicButton = document.getElementById('student_muteMicButton');
const studentMuteVideoButton = document.getElementById('student_muteVideoButton');
const studentFeelBadButton = document.getElementById('student_feelBadButton');
const studentResponseButton = document.getElementById('student_responseButton');
const studentLeaveButton = document.getElementById('student_leaveButton');

let confId, myStream, myScreenStream, role, userId, userName;
let conferences = {};
const studentStreams = {};
const studentStates = {};
let teacherVideoStream = null;

// MediaPipe analysis variables
let mediapipeWs = null;
let isAnalysisActive = false;
let analysisCanvas = null;
let canvasContext = null;
let frameCapture = null;
let lastFrameSent = 0;
const FRAME_INTERVAL = 200; // Send frame every 200ms

function logEvent(message) {
  console.log('[Conference] ' + message);
  const logEntry = document.createElement('div');
  logEntry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
  eventLog.appendChild(logEntry);
  eventLog.scrollTop = eventLog.scrollHeight;
}

async function checkMediaAccess() {
  try {
    logEvent('Checking media access...');
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    logEvent('Media access granted');
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (err) {
    logEvent('Media access denied: ' + err.message);
    alert('Не вдалося отримати доступ до камери або мікрофона. Перевірте дозволи.');
    return false;
  }
}

async function initMedia() {
  logEvent('Initializing media...');
  const hasAccess = await checkMediaAccess();
  if (!hasAccess) return;

  try {
    myStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    logEvent('Media stream acquired');
    if (role === 'teacher') {
      teacherVideo.srcObject = myStream;
      teacherPanel.style.display = 'block';
    } else {
      studentSelfVideo.srcObject = myStream;
      studentPanel.style.display = 'block';
      socket.emit('requestTeacherStream', { confId, userId });
    }

    peer.on('call', (call) => {
      logEvent('Received call from: ' + call.peer);
      const streamType = call.metadata?.type || 'camera';
      logEvent('Stream type from metadata: ' + streamType);
      call.answer(myStream);
      call.on('stream', (remoteStream) => {
        logEvent('Received stream from: ' + call.peer);
        logEvent('Stream details: ' + JSON.stringify(remoteStream.getVideoTracks().map(track => ({ id: track.id, label: track.label }))));

        if (role === 'teacher') {
          if (call.peer !== confId) {
            addVideoStream(call.peer, remoteStream);
          }
        } else if (role === 'student') {
          if (streamType === 'screen') {
            logEvent('This is a screen share stream');
            studentTeacherScreen.srcObject = remoteStream;
            studentTeacherScreen.style.display = 'block';
            studentTeacherScreen.play().catch(err => logEvent('Error playing screen stream: ' + err.message));
          } else {
            logEvent('This is a camera stream');
            if (!teacherVideoStream) {
              teacherVideoStream = remoteStream;
              studentTeacherVideo.srcObject = teacherVideoStream;
              studentTeacherVideo.style.display = 'block';
              studentTeacherVideo.play().catch(err => logEvent('Error playing video stream: ' + err.message));
            }
          }
        }
      });
      call.on('close', () => {
        logEvent('Call closed with: ' + call.peer);
        if (role === 'student' && call.peer === confId) {
          if (streamType === 'screen') {
            studentTeacherScreen.srcObject = null;
            studentTeacherScreen.style.display = 'none';
            socket.emit('requestTeacherStream', { confId, userId });
          }
        }
      });
      call.on('error', (err) => {
        logEvent('Call error: ' + err.message);
      });
    });

    if (role === 'teacher') {
      socket.on('user-connected', (userId) => {
        logEvent(`User connected: ${userId}`);
        callUser(userId, myStream, 'camera');
      });
    }
  } catch (err) {
    logEvent('Error accessing media: ' + err.message);
    alert('Не вдалося ініціалізувати медіа: ' + err.message);
  }
}

confId = window.location.pathname.split('/')[2];
confIdDisplay.textContent = `ID конференції: ${confId}`;

const urlParams = new URLSearchParams(window.location.search);
const studentName = urlParams.get('studentName');
if (studentName) {
  role = 'student';
  userName = studentName;
  logEvent(`Joining as student: ${userName}`);
} else {
  role = 'teacher';
  userName = 'Викладач';
  userId = confId;
  logEvent(`Joining as teacher, ID: ${userId}`);
}

const stateChart = role === 'teacher' ? new Chart(document.getElementById('stateChart'), {
  type: 'doughnut',
  data: {
    labels: ['Уважні', 'Неуважні', 'Відсутні', 'Камера вимкнена'],
    datasets: [{
      data: [0, 0, 0, 0],
      backgroundColor: ['#36A2EB', '#FF6384', '#FFCE56', '#FF9F40']
    }]
  },
  options: { title: { display: true, text: 'Розподіл станів студентів' } }
}) : null;

peer.on('open', (id) => {
  logEvent('PeerJS ID: ' + id);
  userId = id;
  socket.emit('join-room', { confId, userId, userName, role });
  if (role === 'teacher') {
    callUser(confId, myStream, 'camera');
  }
});

peer.on('error', (err) => {
  logEvent('PeerJS error: ' + err.message);
});

function addVideoStream(peerId, stream) {
  if (role === 'teacher') {
    if (studentStreams[peerId]) {
      logEvent(`Updating existing stream for student ${peerId}`);
      const videoElement = document.getElementById(`video-${peerId}`);
      if (videoElement) {
        videoElement.srcObject = stream;
      }
    } else {
      logEvent(`Adding new student stream: ${peerId}`);
      
      const videoContainer = document.createElement('div');
      videoContainer.className = 'video-container';
      videoContainer.id = `container-${peerId}`;
      
      const video = document.createElement('video');
      video.id = `video-${peerId}`;
      video.srcObject = stream;
      video.autoplay = true;
      
      const nameLabel = document.createElement('div');
      nameLabel.className = 'name-label';
      nameLabel.textContent = conferences.students?.find(s => s.id === peerId)?.name || peerId;
      
      // Add analysis overlay
      const analysisOverlay = document.createElement('div');
      analysisOverlay.className = 'analysis-overlay';
      analysisOverlay.id = `analysis-${peerId}`;
      
      // Add analysis canvas for visualization
      const canvas = document.createElement('canvas');
      canvas.className = 'analysis-canvas';
      canvas.id = `canvas-${peerId}`;
      canvas.width = 320;
      canvas.height = 240;
      
      videoContainer.appendChild(video);
      videoContainer.appendChild(nameLabel);
      videoContainer.appendChild(analysisOverlay);
      videoContainer.appendChild(canvas);
      studentVideos.appendChild(videoContainer);
      
      studentStreams[peerId] = stream;
      
      // Initialize student state
      if (!studentStates[peerId]) {
        studentStates[peerId] = {
          attention: 'unknown',
          emotion: 'neutral',
          handRaised: false,
          eyesOpen: true,
          lookingAtScreen: true
        };
      }
    }
  } else if (role === 'student') {
    logEvent(`Received teacher stream: ${peerId}`);
    if (stream.getVideoTracks().length > 0) {
      const track = stream.getVideoTracks()[0];
      if (track.label.includes('screen') || track.label.includes('window')) {
        logEvent('Detected screen share stream');
        studentTeacherScreen.srcObject = stream;
        studentTeacherScreen.style.display = 'block';
      } else {
        logEvent('Detected camera stream');
        studentTeacherVideo.srcObject = stream;
        teacherVideoStream = stream;
      }
    }
  }
}

async function callUser(userId, stream, streamType) {
  if (!stream) {
    logEvent('No stream available to call user: ' + userId);
    return;
  }
  logEvent('Calling user: ' + userId + ' with stream type: ' + streamType);
  try {
    const call = peer.call(userId, stream, { metadata: { type: streamType } });
    logEvent('Call initiated to: ' + userId);
    call.on('stream', (remoteStream) => {
      logEvent('Received stream in call response from: ' + userId);
      logEvent('Stream details: ' + JSON.stringify(remoteStream.getVideoTracks().map(track => ({ id: track.id, label: track.label }))));

      const isScreenShare = call.metadata?.type === 'screen';

      if (role === 'teacher') {
        if (userId !== confId) {
          addVideoStream(userId, remoteStream);
        }
      } else if (role === 'student') {
        if (isScreenShare) {
          logEvent('Received screen share stream from teacher');
          studentTeacherScreen.srcObject = remoteStream;
          studentTeacherScreen.style.display = 'block';
          studentTeacherScreen.play().catch(err => logEvent('Error playing screen stream: ' + err.message));
        } else {
          if (!teacherVideoStream) {
            logEvent('Received camera stream from teacher');
            teacherVideoStream = remoteStream;
            studentTeacherVideo.srcObject = teacherVideoStream;
            studentTeacherVideo.style.display = 'block';
            studentTeacherVideo.play().catch(err => logEvent('Error playing video stream: ' + err.message));
          }
        }
      }
    });
    call.on('close', () => {
      logEvent('Call closed with: ' + userId);
      if (role === 'student' && userId === confId) {
        const isScreenShare = call.metadata?.type === 'screen';
        if (isScreenShare) {
          studentTeacherScreen.srcObject = null;
          studentTeacherScreen.style.display = 'none';
          socket.emit('requestTeacherStream', { confId, userId });
        }
      }
    });
    call.on('error', (err) => {
      logEvent('Error in call: ' + err);
    });
  } catch (err) {
    logEvent('Error calling user: ' + err);
  }
}

socket.on('updateStudentList', (students) => {
  if (role !== 'teacher') return;
  logEvent('Updating student list: ' + JSON.stringify(students));
  studentTable.innerHTML = '';

  if (!conferences) conferences = { students: [] };
  conferences.students = Object.keys(students).map(id => ({
    id,
    name: students[id].name
  }));

  Object.keys(students).forEach(studentId => {
    const student = students[studentId];
    const row = document.createElement('tr');
    row.id = `student-row-${studentId}`;
    
    row.innerHTML = `
      <td>${student.name}</td>
      <td class="attention-cell">${student.attention || 'unknown'}</td>
      <td class="emotion-cell">${student.emotion || 'neutral'}</td>
      <td class="hand-raised-cell">${student.handRaised ? 'Yes' : 'No'}</td>
      <td class="eyes-open-cell">${student.eyesOpen ? 'Open' : 'Closed'}</td>
      <td class="looking-cell">${student.lookingAtScreen ? 'Yes' : 'No'}</td>
      <td><button class="call-button" data-student-id="${studentId}">Викликати</button></td>
    `;
    
    studentTable.appendChild(row);
  });
  
  document.querySelectorAll('.call-button').forEach(button => {
    button.addEventListener('click', () => {
      const studentId = button.getAttribute('data-student-id');
      socket.emit('callStudent', { confId, studentId });
    });
  });
});

socket.on('user-disconnected', ({ studentId }) => {
  if (role !== 'teacher') return;
  logEvent('User disconnected: ' + studentId);
  removeVideoStream(studentId);
  const row = document.getElementById(`student-row-${studentId}`);
  if (row) row.remove();
});

function simulateStudentState(studentId) {
  const states = ['attentive', 'distracted', 'confused', 'sleepy'];
  const emotions = ['neutral', 'happy', 'sad', 'surprised'];
  const state = states[Math.floor(Math.random() * states.length)];
  const emotion = emotions[Math.floor(Math.random() * emotions.length)];
  socket.emit('updateState', { confId, studentId, state, emotion, camera: true });
}

// MediaPipe Analysis Functions
function initMediaPipeAnalysis() {
  if (role === 'student' && myStream) {
    logEvent('Initializing MediaPipe analysis');
    
    // Create a hidden canvas for frame capture
    analysisCanvas = document.createElement('canvas');
    analysisCanvas.width = 320;
    analysisCanvas.height = 240;
    canvasContext = analysisCanvas.getContext('2d');
    
    // Connect to MediaPipe WebSocket server
    connectToMediaPipeServer();
    
    // Start sending frames
    startFrameCapture();
  } else if (role === 'teacher') {
    logEvent('Teacher role detected - ready to receive analysis results');
  }
}

function connectToMediaPipeServer() {
  try {
    mediapipeWs = new WebSocket('ws://localhost:8765');
    
    mediapipeWs.onopen = () => {
      logEvent('Connected to MediaPipe analysis server');
      
      // Register student with the analysis server
      mediapipeWs.send(JSON.stringify({
        type: 'registration',
        studentId: userId,
        confId: confId
      }));
      
      isAnalysisActive = true;
    };
    
    mediapipeWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'registration_success') {
          logEvent('Successfully registered with MediaPipe server: ' + data.message);
        } else if (data.type === 'analysis_result') {
          // Handle analysis result
          handleAnalysisResult(data);
        }
      } catch (error) {
        logEvent('Error parsing WebSocket message: ' + error.message);
      }
    };
    
    mediapipeWs.onerror = (error) => {
      logEvent('MediaPipe WebSocket error: ' + error.message);
      isAnalysisActive = false;
    };
    
    mediapipeWs.onclose = () => {
      logEvent('MediaPipe WebSocket connection closed');
      isAnalysisActive = false;
      
      // Try to reconnect after 5 seconds
      setTimeout(() => {
        if (role === 'student' && myStream) {
          connectToMediaPipeServer();
        }
      }, 5000);
    };
  } catch (error) {
    logEvent('Failed to connect to MediaPipe server: ' + error.message);
  }
}

function startFrameCapture() {
  if (!frameCapture) {
    frameCapture = setInterval(() => {
      captureAndSendFrame();
    }, FRAME_INTERVAL);
  }
}

function stopFrameCapture() {
  if (frameCapture) {
    clearInterval(frameCapture);
    frameCapture = null;
  }
}

function captureAndSendFrame() {
  if (!isAnalysisActive || !mediapipeWs || mediapipeWs.readyState !== WebSocket.OPEN || !myStream) {
    return;
  }
  
  const now = Date.now();
  if (now - lastFrameSent < FRAME_INTERVAL) {
    return;
  }
  
  try {
    // Draw current video frame to canvas
    const videoTrack = myStream.getVideoTracks()[0];
    if (videoTrack && videoTrack.enabled) {
      canvasContext.drawImage(studentSelfVideo, 0, 0, analysisCanvas.width, analysisCanvas.height);
      
      // Convert canvas to base64 image
      const imageData = analysisCanvas.toDataURL('image/jpeg', 0.7);
      const base64Frame = imageData.split(',')[1];
      
      // Send frame to MediaPipe server
      mediapipeWs.send(JSON.stringify({
        type: 'video_frame',
        studentId: userId,
        frame: base64Frame
      }));
      
      lastFrameSent = now;
    }
  } catch (error) {
    logEvent('Error capturing frame: ' + error.message);
  }
}

function handleAnalysisResult(data) {
  const { studentId, result, annotatedFrame } = data;
  
  if (role === 'student') {
    // Update student's own analysis overlay
    updateAnalysisOverlay(result);
    
    // Display the annotated frame if available
    if (annotatedFrame) {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = 'data:image/jpeg;base64,' + annotatedFrame;
    }
    
    // Send analysis results to server for teacher to see
    socket.emit('updateState', {
      confId,
      studentId: userId,
      attention: result.attention,
      emotion: result.emotion,
      handRaised: result.hand_raised,
      eyesOpen: result.eyes_open,
      lookingAtScreen: result.looking_at_screen,
      camera: true
    });
  } else if (role === 'teacher') {
    // Update the student's state in the UI
    updateStudentState(studentId, {
      attention: result.attention,
      emotion: result.emotion,
      handRaised: result.hand_raised,
      eyesOpen: result.eyes_open,
      lookingAtScreen: result.looking_at_screen
    });
    
    // Display the annotated frame
    if (annotatedFrame) {
      const canvas = document.getElementById(`canvas-${studentId}`);
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = 'data:image/jpeg;base64,' + annotatedFrame;
      }
    }
  }
}

function updateAnalysisOverlay(result) {
  // For student to see their own analysis
  const overlay = document.createElement('div');
  overlay.className = 'self-analysis';
  overlay.innerHTML = `
    <div class="analysis-item ${result.attention}">Attention: ${result.attention}</div>
    <div class="analysis-item ${result.emotion}">Emotion: ${result.emotion}</div>
    <div class="analysis-item ${result.hand_raised ? 'active' : ''}">Hand raised: ${result.hand_raised ? 'Yes' : 'No'}</div>
  `;
  
  // Replace existing overlay if any
  const existingOverlay = document.querySelector('.self-analysis');
  if (existingOverlay) {
    existingOverlay.replaceWith(overlay);
  } else {
    studentSelfVideoContainer.appendChild(overlay);
  }
}

function updateStudentState(studentId, state) {
  // Update the student state in our local tracking
  studentStates[studentId] = state;
  
  // Update the student's row in the table
  const row = document.getElementById(`student-row-${studentId}`);
  if (row) {
    const attentionCell = row.querySelector('.attention-cell');
    const emotionCell = row.querySelector('.emotion-cell');
    const handRaisedCell = row.querySelector('.hand-raised-cell');
    
    if (attentionCell) {
      attentionCell.textContent = state.attention;
      attentionCell.className = 'attention-cell ' + state.attention;
    }
    
    if (emotionCell) {
      emotionCell.textContent = state.emotion;
      emotionCell.className = 'emotion-cell ' + state.emotion;
    }
    
    if (handRaisedCell) {
      handRaisedCell.textContent = state.handRaised ? 'Yes' : 'No';
      handRaisedCell.className = 'hand-raised-cell ' + (state.handRaised ? 'active' : '');
    }
  }
  
  // Update the video container with visual indicators
  const container = document.getElementById(`container-${studentId}`);
  if (container) {
    // Remove existing status classes
    container.classList.remove('attentive', 'not_looking', 'sleepy', 'tired');
    container.classList.add(state.attention);
    
    // Update the analysis overlay
    const overlay = document.getElementById(`analysis-${studentId}`);
    if (overlay) {
      overlay.innerHTML = `
        <div class="indicator attention ${state.attention}"></div>
        <div class="indicator emotion ${state.emotion}"></div>
        <div class="indicator hand-raised ${state.handRaised ? 'active' : ''}"></div>
      `;
    }
  }
}

socket.on('screenShared', ({ confId }) => {
  logEvent('Teacher is sharing screen');
});

socket.on('screenShareEnded', ({ confId }) => {
  logEvent('Teacher stopped sharing screen');
  if (role === 'student') {
    if (studentTeacherScreen.srcObject) {
      const tracks = studentTeacherScreen.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      studentTeacherScreen.srcObject = null;
    }
    studentTeacherScreen.style.display = 'none';
    socket.emit('requestTeacherStream', { confId, userId });
  }
});

socket.on('conferenceData', (data) => {
  logEvent('Received conference data');
  conferences = data;
});

socket.on('requestTeacherStream', ({ confId, userId }) => {
  if (conferences[confId] && conferences[confId].teacher.socketId) {
    io.to(conferences[confId].teacher.socketId).emit('callStudent', { confId, studentId: userId });
  }
});

socket.on('user-connected', (userId) => {
  logEvent(`User connected: ${userId}`);
  if (role === 'teacher') {
    setTimeout(() => {
      callUser(userId, myStream, 'camera');
    }, 1000);
  } else if (role === 'student') {
    setTimeout(() => {
      socket.emit('requestTeacherStream', { confId, userId: peer.id });
    }, 1000);
  }
});

socket.on('conferenceEnded', () => {
  logEvent('Conference ended');
  if (myStream) myStream.getTracks().forEach(track => track.stop());
  if (myScreenStream) myScreenStream.getTracks().forEach(track => track.stop());
  window.location.href = role === 'teacher' ? '/teacher' : '/student';
});

socket.on('error', ({ message }) => {
  logEvent(`Error: ${message}`);
  alert(message);
  window.location.href = role === 'teacher' ? '/teacher' : '/student';
});

teacherMuteMicButton?.addEventListener('click', () => {
  if (!myStream) return;
  logEvent('Toggle mute mic');
  const audioTracks = myStream.getAudioTracks();
  audioTracks[0].enabled = !audioTracks[0].enabled;
  teacherMuteMicButton.classList.toggle('muted');
  teacherMuteMicButton.textContent = audioTracks[0].enabled ? 'Вимкнути мікрофон' : 'Увімкнути мікрофон';
  socket.emit('muteMic', { confId, userId });
});

teacherMuteVideoButton?.addEventListener('click', () => {
  if (!myStream) return;
  logEvent('Toggle mute video');
  const videoTracks = myStream.getVideoTracks();
  videoTracks[0].enabled = !videoTracks[0].enabled;
  teacherMuteVideoButton.classList.toggle('muted');
  teacherMuteVideoButton.textContent = videoTracks[0].enabled ? 'Вимкнути камеру' : 'Увімкнути камеру';
  socket.emit('muteVideo', { confId, userId });
});

teacherShareScreenButton?.addEventListener('click', async () => {
  if (role !== 'teacher') return;

  if (myScreenStream) {
    stopScreenSharing();
    return;
  }

  logEvent('Share screen button clicked');
  try {
    myScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    logEvent('Screen stream acquired: ' + JSON.stringify(myScreenStream.getVideoTracks().map(track => ({ id: track.id, label: track.label }))));
    teacherScreen.srcObject = myScreenStream;
    teacherScreen.style.display = 'block';
    socket.emit('shareScreen', { confId });

    teacherShareScreenButton.textContent = 'Зупинити демонстрацію';
    teacherShareScreenButton.classList.add('sharing');

    Object.keys(studentStreams).forEach(studentId => {
      logEvent(`Sharing screen with student: ${studentId}`);
      callUser(studentId, myScreenStream, 'screen');
    });

    myScreenStream.getVideoTracks()[0].onended = () => {
      stopScreenSharing();
    };
  } catch (err) {
    logEvent('Error sharing screen: ' + err.message);
    alert('Не вдалося поділитися екраном: ' + err.message);
  }
});

function stopScreenSharing() {
  logEvent('Screen sharing ended');
  if (myScreenStream) {
    myScreenStream.getTracks().forEach(track => {
      track.stop();
      logEvent(`Stopped track: ${track.kind} - ${track.label}`);
    });
  }

  teacherScreen.style.display = 'none';
  teacherScreen.srcObject = null;
  myScreenStream = null;

  teacherShareScreenButton.textContent = 'Поділитися екраном';
  teacherShareScreenButton.classList.remove('sharing');

  socket.emit('screenShareEnded', { confId });

  if (myStream && role === 'teacher') {
    Object.keys(studentStreams).forEach(studentId => {
      logEvent(`Re-sharing teacher video with student: ${studentId}`);
      callUser(studentId, myStream, 'camera');
    });
  }
}

teacherAttentionTestButton?.addEventListener('click', () => {
  if (role !== 'teacher') return;
  logEvent('Attention test button clicked');
});

teacherLeaveButton?.addEventListener('click', () => {
  logEvent('Leave button clicked');
  if (myStream) myStream.getTracks().forEach(track => track.stop());
  if (myScreenStream) myScreenStream.getTracks().forEach(track => track.stop());
  window.location.href = '/teacher';
});

studentMuteMicButton?.addEventListener('click', () => {
  if (!myStream) return;
  logEvent('Toggle mute mic');
  const audioTracks = myStream.getAudioTracks();
  audioTracks[0].enabled = !audioTracks[0].enabled;
  studentMuteMicButton.classList.toggle('muted');
  studentMuteMicButton.textContent = audioTracks[0].enabled ? 'Вимкнути мікрофон' : 'Увімкнути мікрофон';
  socket.emit('muteMic', { confId, userId });
});

studentMuteVideoButton?.addEventListener('click', () => {
  if (!myStream) return;
  logEvent('Toggle mute video');
  const videoTracks = myStream.getVideoTracks();
  videoTracks[0].enabled = !videoTracks[0].enabled;
  studentMuteVideoButton.classList.toggle('muted');
  studentMuteVideoButton.textContent = videoTracks[0].enabled ? 'Вимкнути камеру' : 'Увімкнути камеру';
  socket.emit('muteVideo', { confId, userId });
});

studentFeelBadButton?.addEventListener('click', () => {
  if (role !== 'student') return;
  logEvent('Feel bad button clicked');
  socket.emit('feelBad', { confId, studentId: userId });
});

studentResponseButton?.addEventListener('click', () => {
  if (role !== 'student') return;
  logEvent('Response button clicked');
  socket.emit('studentResponse', { confId, studentId: userId });
  studentResponseButton.style.display = 'none';
});

studentLeaveButton?.addEventListener('click', () => {
  logEvent('Leave button clicked');
  if (myStream) myStream.getTracks().forEach(track => track.stop());
  if (myScreenStream) myScreenStream.getTracks().forEach(track => track.stop());
  window.location.href = '/student';
});

document.addEventListener('DOMContentLoaded', () => {
  logEvent('DOM fully loaded');
  loadingMessage.style.display = 'none';
  initMedia();
  
  // Initialize MediaPipe analysis after media is initialized
  setTimeout(() => {
    initMediaPipeAnalysis();
  }, 2000);
});