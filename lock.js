const unlockBtn = document.getElementById('unlock');
const passwordInput = document.getElementById('pass');
const errorMsg = document.getElementById('err');
const forgotBtn = document.getElementById('btn-forgot');
const backBtn = document.getElementById('btn-back');
const recoverBtn = document.getElementById('btn-recover');
const recoveryInput = document.getElementById('recovery-code');

const viewLock = document.getElementById('view-lock');
const viewRecovery = document.getElementById('view-recovery');

// --- UNLOCK LOGIC ---
function triggerUnlock() {
    unlockBtn.disabled = true;
    passwordInput.disabled = true;
    unlockBtn.textContent = "Checking...";
    errorMsg.style.display = 'none';

    const password = passwordInput.value;

    chrome.runtime.sendMessage({ action: "validatePassword", password: password }, (res) => {
        if (res && res.success) {
            // Background handles opening
        } else {
            unlockBtn.disabled = false;
            passwordInput.disabled = false;
            unlockBtn.textContent = "Unlock";
            errorMsg.textContent = "Incorrect Password";
            errorMsg.style.display = 'block';
            passwordInput.focus();
        }
    });
}

unlockBtn.addEventListener('click', triggerUnlock);
passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') triggerUnlock();
});

// --- FORGOT PASSWORD LOGIC ---
forgotBtn.addEventListener('click', () => {
    viewLock.classList.add('hidden');
    viewRecovery.classList.remove('hidden');
    errorMsg.style.display = 'none';
});

backBtn.addEventListener('click', () => {
    viewRecovery.classList.add('hidden');
    viewLock.classList.remove('hidden');
    errorMsg.style.display = 'none';
});

recoverBtn.addEventListener('click', () => {
    const code = recoveryInput.value.trim();
    if (!code) return;

    recoverBtn.disabled = true;
    recoverBtn.textContent = "Verifying...";

    chrome.runtime.sendMessage({ action: "validateRecovery", recoveryCode: code }, (res) => {
        if (res && res.success) {
            // Success
        } else {
            recoverBtn.disabled = false;
            recoverBtn.textContent = "Reset & Unlock";
            errorMsg.textContent = "Invalid Recovery Code";
            errorMsg.style.display = 'block';
        }
    });
});