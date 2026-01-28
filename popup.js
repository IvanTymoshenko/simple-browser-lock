async function hashText(text) {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateRecoveryCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// YOUR DONATION LINK
const DONATION_URL = "https://buymeacoffee.com/mr.ivan.tymoshenko";

document.addEventListener('DOMContentLoaded', () => {
    // Views
    const viewSetup = document.getElementById('view-setup');
    const viewDashboard = document.getElementById('view-dashboard');
    const viewRecovery = document.getElementById('view-recovery');
    const recoveryResult = document.getElementById('recovery-result');
    
    // Elements
    const setupInputs = document.querySelectorAll('#view-setup input');
    const saveBtn = document.getElementById('btn-save');
    const laterBtn = document.getElementById('btn-later');
    const recoveryMsg = document.getElementById('recovery-msg');

    // 1. Initial State Check
    chrome.storage.local.get(['masterHash'], (result) => {
        if (result.masterHash) {
            viewDashboard.classList.remove('hidden');
        } else {
            viewSetup.classList.remove('hidden');
        }
    });

    document.getElementById('btn-lock-now').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "manualLock" });
        window.close();
    });

    // 2. SETUP LOGIC (First Time)
    saveBtn.addEventListener('click', async () => {
        const p1 = document.getElementById('setup-pass').value;
        const p2 = document.getElementById('setup-confirm').value;
        const msg = document.getElementById('setup-msg');

        if (p1 && p1 === p2) {
            const passwordHash = await hashText(p1);
            const recoveryCode = generateRecoveryCode();
            const recoveryHash = await hashText(recoveryCode);

            await chrome.storage.local.set({ 
                masterHash: passwordHash, 
                recoveryHash: recoveryHash,
                isLocked: false 
            });

            // Show Recovery Code
            laterBtn.style.display = 'none';
            setupInputs.forEach(i => i.classList.add('hidden'));
            saveBtn.classList.add('hidden');
            document.querySelector('#view-setup h3').textContent = "Setup Complete";
            document.querySelector('#view-setup > p').style.display = 'none';
            
            document.getElementById('new-recovery-code').textContent = recoveryCode;
            recoveryResult.classList.remove('hidden');
        } else {
            msg.textContent = "Passwords do not match";
            msg.className = "status-msg error-msg";
        }
    });

    laterBtn.addEventListener('click', () => window.close());
    document.getElementById('btn-finish-setup').addEventListener('click', () => window.close());

    // 3. CHANGE PASSWORD LOGIC (Generates NEW Code)
    document.getElementById('btn-change').addEventListener('click', async () => {
        const oldPass = document.getElementById('change-old').value;
        const newPass = document.getElementById('change-new').value;
        const confirmPass = document.getElementById('change-confirm').value;
        const msg = document.getElementById('dashboard-msg');

        const oldHash = await hashText(oldPass);
        
        chrome.storage.local.get(['masterHash'], async (result) => {
            if (result.masterHash === oldHash) {
                if(newPass === confirmPass && newPass) {
                    // 1. New Password Hash
                    const newHash = await hashText(newPass);
                    
                    // 2. NEW Recovery Code
                    const newRecoveryCode = generateRecoveryCode();
                    const newRecoveryHash = await hashText(newRecoveryCode);

                    // 3. Save Both
                    await chrome.storage.local.set({ 
                        masterHash: newHash,
                        recoveryHash: newRecoveryHash 
                    });

                    // 4. Show User the New Code
                    viewDashboard.classList.add('hidden');
                    viewSetup.classList.remove('hidden'); // Reuse setup screen
                    
                    document.querySelector('#view-setup h3').textContent = "Password Updated";
                    document.querySelector('#view-setup > p').textContent = "Here is your NEW recovery code. The old one is invalid.";
                    document.querySelector('#view-setup > p').style.display = 'block';
                    
                    setupInputs.forEach(i => i.classList.add('hidden'));
                    saveBtn.classList.add('hidden');
                    laterBtn.style.display = 'none';
                    document.getElementById('setup-msg').textContent = '';

                    document.getElementById('new-recovery-code').textContent = newRecoveryCode;
                    recoveryResult.classList.remove('hidden');

                } else {
                    msg.textContent = "New passwords do not match";
                    msg.className = "status-msg error-msg";
                }
            } else {
                msg.textContent = "Current password incorrect";
                msg.className = "status-msg error-msg";
            }
        });
    });

    // 4. RECOVERY LOGIC
    document.getElementById('btn-goto-recovery').addEventListener('click', () => {
        viewDashboard.classList.add('hidden');
        viewRecovery.classList.remove('hidden');
        recoveryMsg.textContent = '';
    });

    document.getElementById('btn-back-dashboard').addEventListener('click', () => {
        viewRecovery.classList.add('hidden');
        viewDashboard.classList.remove('hidden');
    });

    document.getElementById('btn-reset-confirm').addEventListener('click', async () => {
        const codeInput = document.getElementById('recovery-input').value.trim();
        if (!codeInput) return;

        const inputHash = await hashText(codeInput);
        
        chrome.storage.local.get(['recoveryHash'], async (result) => {
            if (result.recoveryHash === inputHash) {
                await chrome.storage.local.remove(['masterHash', 'recoveryHash']);
                location.reload();
            } else {
                recoveryMsg.textContent = "Invalid Recovery Code";
                recoveryMsg.className = "status-msg error-msg";
            }
        });
    });

    // 5. DONATION BUTTON (UNLOCKED STATE -> NEW TAB)
    const donateButtons = document.querySelectorAll('.donate-btn');
    donateButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            chrome.tabs.create({ url: DONATION_URL });
        });
    });
});