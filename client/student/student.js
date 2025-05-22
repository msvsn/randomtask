console.log('[Student] Initializing student client...');

const joinForm = document.getElementById('joinForm');
const studentNameInput = document.getElementById('studentName');
const confIdInput = document.getElementById('confId');
const joinButton = document.getElementById('joinButton');

console.log('[Student] DOM elements initialized:', {
  joinForm: !!joinForm,
  studentNameInput: !!studentNameInput,
  confIdInput: !!confIdInput,
  joinButton: !!joinButton,
});

joinButton.addEventListener('click', () => {
  const studentName = studentNameInput.value.trim();
  const confId = confIdInput.value.trim();
  console.log('[Student] Join button clicked, studentName:', studentName, 'confId:', confId);
  if (!studentName || !confId) {
    console.log('[Student] Error: studentName or confId is empty');
    alert('Введіть ім’я та ID конференції');
    return;
  }
  console.log('[Student] Redirecting to /join-conference');
  window.location.href = `/join-conference?confId=${encodeURIComponent(confId)}&studentName=${encodeURIComponent(studentName)}`;
});