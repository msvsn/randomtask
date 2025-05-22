console.log('[Teacher] Initializing teacher client...');

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Teacher] DOM fully loaded');

  const createForm = document.getElementById('createForm');
  const teacherNameInput = document.getElementById('teacherName');
  const createButton = document.getElementById('createButton');

  console.log('[Teacher] DOM elements initialized:', {
    createForm: !!createForm,
    teacherNameInput: !!teacherNameInput,
    createButton: !!createButton,
  });

  if (!createButton) {
    console.error('[Teacher] Error: createButton not found in DOM');
  } else {
    console.log('[Teacher] createButton found, adding click event listener');
  }

  createButton.addEventListener('click', () => {
    console.log('[Teacher] Create button clicked');
    const teacherName = teacherNameInput.value.trim();
    console.log('[Teacher] teacherName value:', teacherName);
    if (!teacherName) {
      console.log('[Teacher] Error: teacherName is empty');
      alert('Введіть ваше ім’я');
      return;
    }
    console.log('[Teacher] Redirecting to /create-conference');
    window.location.href = `/create-conference?teacherName=${encodeURIComponent(teacherName)}`;
  });
});