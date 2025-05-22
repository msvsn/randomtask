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
const studentStreams = {};
const studentStates = {};

function logEvent(message) {
  console.log('[Conference] ' + message);
  const logEntry = document.createElement('div');
  logEntry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
  eventLog.appendChild(logEntry);
  eventLog.scrollTop = eventLog.scrollHeight;
}

// Перевірка доступу до медіа
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

// Ініціалізація медіа
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
      studentSelfVideo.srcObject = myStream; // Студент бачить себе
      studentPanel.style.display = 'block';
      socket.emit('requestTeacherStream', { confId, userId }); // Запит стріму викладача
    }

    peer.on('call', (call) => {
      logEvent('Received call from: ' + call.peer);
      call.answer(myStream);
      call.on('stream', (remoteStream) => {
        logEvent('Received remote stream from: ' + call.peer);
        if (remoteStream.getVideoTracks().some(track => track.label.toLowerCase().includes('screen'))) {
          logEvent('Detected screen share stream');
          if (role === 'teacher') {
            teacherScreen.srcObject = remoteStream;
            teacherScreen.style.display = 'block';
          } else {
            studentTeacherScreen.srcObject = remoteStream;
            studentTeacherScreen.style.display = 'block'; // Показуємо трансляцію екрану
          }
        } else {
          if (role === 'teacher') {
            addVideoStream(call.peer, remoteStream);
          } else if (call.peer === confId) { // Викладач викликає студента
            studentTeacherVideo.srcObject = remoteStream; // Студент бачить викладача
          }
        }
      });
      call.on('error', (err) => {
        logEvent('Call error: ' + err.message);
      });
    });

    if (role === 'teacher') {
      socket.on('user-connected', (remoteUserId) => {
        logEvent('User connected: ' + remoteUserId);
        callUser(remoteUserId, myStream); // Викладач викликає всіх студентів
      });
    }
  } catch (err) {
    logEvent('Error accessing media: ' + err.message);
    alert('Не вдалося ініціалізувати медіа: ' + err.message);
  }
}

// Визначаємо confId з URL
confId = window.location.pathname.split('/')[2];
confIdDisplay.textContent = `ID конференції: ${confId}`;

// Визначаємо роль (викладач чи студент) і ім’я
const urlParams = new URLSearchParams(window.location.search);
userName = urlParams.get('studentName') || decodeURIComponent(window.location.search.split('teacherName=')[1] || '');
role = urlParams.get('studentName') ? 'student' : 'teacher';
userId = role === 'teacher' ? confId : `student_${Math.random().toString(36).substr(2, 9)}`;
logEvent(`User details: ${JSON.stringify({ confId, role, userId, userName })}`);

// Ініціалізація діаграми (для викладача)
const stateChart = role === 'teacher' ? new Chart(document.getElementById('stateChart'), {
  type: 'pie',
  data: {
    labels: ['Уважні', 'Сонні', 'Втомлені', 'Немає обличчя'],
    datasets: [{
      data: [0, 0, 0, 0],
      backgroundColor: ['#36A2EB', '#FF6384', '#FFCE56', '#FF9F40']
    }]
  },
  options: { title: { display: true, text: 'Розподіл станів студентів' } }
}) : null;

// Підключення до PeerJS
peer.on('open', (id) => {
  logEvent('PeerJS ID: ' + id);
  socket.emit('join-room', { confId, userId, userName, role });
  if (role === 'teacher') {
    callUser(confId, myStream); // Викладач викликає себе для відображення
  }
});

peer.on('error', (err) => {
  logEvent('PeerJS error: ' + err.message);
});

// Додавання відео до сторінки (для викладача)
function addVideoStream(peerId, stream) {
  if (role !== 'teacher') return; // Студенти не бачать інших студентів
  logEvent('Adding video stream for peer: ' + peerId);
  const videoContainer = document.createElement('div');
  const video = document.createElement('video');
  video.id = `video-${peerId}`;
  video.srcObject = stream;
  video.autoplay = true;
  const label = document.createElement('h4');
  label.textContent = peerId;
  videoContainer.appendChild(label);
  videoContainer.appendChild(video);
  studentVideos.appendChild(videoContainer);
  studentStreams[peerId] = stream;
}

// Виклик користувача
function callUser(userId, stream) {
  if (!stream) return; // Перевірка, що стрім існує
  logEvent('Calling user: ' + userId);
  const call = peer.call(userId, stream);
  call.on('stream', (remoteStream) => {
    if (role === 'teacher') {
      addVideoStream(userId, remoteStream);
    }
  });
  call.on('close', () => {
    if (studentStreams[userId]) {
      const videoElement = document.getElementById(`video-${userId}`);
      if (videoElement) videoElement.parentElement.remove();
    }
  });
  call.on('error', (err) => {
    logEvent('Call error: ' + err.message);
  });
}

// Оновлення списку студентів (для викладача)
socket.on('updateStudentList', (students) => {
  if (role !== 'teacher') return;
  logEvent('Updating student list: ' + JSON.stringify(students));
  studentTable.innerHTML = '';
  Object.keys(students).forEach((studentId) => {
    const student = students[studentId];
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${student.name}</td>
      <td class="attention">${student.attention || 'unknown'}</td>
      <td class="emotion">${student.emotion || 'neutral'}</td>
      <td class="camera">${student.camera || 'on'}</td>
      <td><button onclick="callStudent('${studentId}')">Звернутися</button></td>
    `;
    studentTable.appendChild(row);
    if (!studentStates[studentId]) {
      setInterval(() => simulateStudentState(studentId), 5000);
    }
  });
  updateChart();
});

// Симуляція стану студента
function simulateStudentState(studentId) {
  const states = ['attentive', 'sleepy', 'tired', 'not_looking'];
  const emotions = ['happy', 'neutral', 'sad'];
  const attention = states[Math.floor(Math.random() * states.length)];
  const emotion = emotions[Math.floor(Math.random() * emotions.length)];
  socket.emit('studentState', { confId, studentId, attention, emotion, camera: 'on' });
}

// Оновлення стану студента
socket.on('updateState', ({ studentId, attention, emotion, camera }) => {
  if (role !== 'teacher') return;
  logEvent(`Updating state for student: ${JSON.stringify({ studentId, attention, emotion, camera })}`);
  studentStates[studentId] = { attention, emotion, camera };
  const row = Array.from(studentTable.rows).find((r) => r.cells[0].textContent === studentId);
  if (row) {
    row.cells[1].textContent = attention;
    row.cells[2].textContent = emotion;
    row.cells[3].textContent = camera;
    if (attention === 'not_looking' || camera === 'off') {
      row.classList.add('inactive');
      studentTable.insertBefore(row, studentTable.firstChild);
    } else {
      row.classList.remove('inactive');
    }
  }
  updateChart();
});

// Оновлення діаграми
function updateChart() {
  if (!stateChart) return;
  logEvent('Updating chart');
  const counts = { attentive: 0, sleepy: 0, tired: 0, no_face: 0 };
  Object.values(studentStates).forEach(state => {
    if (state.attention === 'attentive') counts.attentive++;
    else if (state.attention === 'sleepy') counts.sleepy++;
    else if (state.attention === 'not_looking') counts.no_face++;
    else counts.tired++;
  });
  stateChart.data.datasets[0].data = [counts.attentive, counts.sleepy, counts.tired, counts.no_face];
  stateChart.update();
}

// Обробка подій
socket.on('alert', ({ message }) => {
  logEvent(`Alert: ${message}`);
});

socket.on('noResponse', ({ studentId }) => {
  if (role !== 'teacher') return;
  logEvent(`No response from student: ${studentId}`);
});

socket.on('callStudent', ({ confId, studentId }) => {
  if (role !== 'student' || userId !== studentId) return;
  logEvent('Teacher called');
  studentResponseButton.style.display = 'block';
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

// Кнопки для викладача
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
  if (role !== 'teacher' || !myStream) return;
  logEvent('Share screen button clicked');
  try {
    myScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); // Додаємо аудіо
    teacherScreen.srcObject = myScreenStream;
    teacherScreen.style.display = 'block';
    socket.emit('shareScreen', { confId });
    Object.keys(studentStreams).forEach(studentId => {
      const call = peer.call(studentId, myScreenStream);
    });
    myScreenStream.getVideoTracks()[0].onended = () => {
      teacherScreen.style.display = 'none';
      studentTeacherScreen.style.display = 'none'; // Приховуємо екран студента після завершення
    };
  } catch (err) {
    logEvent('Error sharing screen: ' + err.message);
    alert('Не вдалося поділитися екраном: ' + err.message);
  }
});

teacherAttentionTestButton?.addEventListener('click', () => {
  if (role !== 'teacher') return;
  logEvent('Attention test button clicked');
  socket.emit('attentionTest', { confId });
});

teacherLeaveButton?.addEventListener('click', () => {
  logEvent('Leave button clicked');
  if (myStream) myStream.getTracks().forEach(track => track.stop());
  if (myScreenStream) myScreenStream.getTracks().forEach(track => track.stop());
  window.location.href = '/teacher';
});

// Кнопки для студента
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

// Ініціалізація
document.addEventListener('DOMContentLoaded', () => {
  logEvent('DOM fully loaded');
  loadingMessage.style.display = 'none';
  initMedia();
});