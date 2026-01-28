// 1. Utility: Hash Function (SHA-256)
async function hashText(text) {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

let isUnlocking = false;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// --- SMART SETUP REMINDER ---
async function checkSetupNeeded() {
    const data = await chrome.storage.local.get(['masterHash', 'nextReminder']);
    if (data.masterHash) return;

    const now = Date.now();
    if (!data.nextReminder || now > data.nextReminder) {
        openSetupWindow();
        await chrome.storage.local.set({ nextReminder: now + SEVEN_DAYS_MS });
    }
}

function openSetupWindow() {
    chrome.tabs.query({}, (tabs) => {
        const existingSetup = tabs.find(t => t.url.includes("popup.html?mode=setup"));
        if (existingSetup) {
            chrome.windows.update(existingSetup.windowId, { focused: true });
            return;
        }
        chrome.windows.create({
            url: chrome.runtime.getURL("popup.html?mode=setup"),
            type: "popup",
            width: 420,
            height: 600,
            focused: true
        });
    });
}

// 2. The Core Locking Logic
async function lockBrowser() {
    const data = await chrome.storage.local.get(['masterHash', 'isLocked', 'savedSession']);
    
    if (!data.masterHash) {
        checkSetupNeeded();
        return;
    }

    const allWindows = await chrome.windows.getAll({ populate: true });

    if (data.isLocked) {
        const existingLockWindow = allWindows.find(win => 
            win.tabs.some(tab => tab.url.includes("lock.html"))
        );

        allWindows.forEach(win => {
            // 1. Keep the Lock Window open
            if (existingLockWindow && win.id === existingLockWindow.id) return;
            
            // 2. Close everything else
            chrome.windows.remove(win.id).catch(() => {});
        });

        if (existingLockWindow) {
            chrome.windows.update(existingLockWindow.id, { focused: true });
        } else {
            createLockWindow();
        }
        return;
    }

    // Saving Session (Only if unlocked)
    let rawUrls = [];
    let originalBounds = null;

    if (allWindows.length > 0) {
        const normalWin = allWindows.find(w => w.type === 'normal') || allWindows[0];
        originalBounds = {
            width: normalWin.width,
            height: normalWin.height,
            top: normalWin.top,
            left: normalWin.left
        };

        allWindows.forEach(win => {
            win.tabs.forEach(tab => {
                const isExtensionPage = tab.url.includes(chrome.runtime.id);
                const isInternal = tab.url.startsWith('chrome://') || tab.url.startsWith('about:');
                if (!isExtensionPage && !isInternal && tab.url.startsWith('http')) {
                    rawUrls.push(tab.url);
                }
            });
        });
    }

    const uniqueUrls = [...new Set(rawUrls)];

    await chrome.storage.local.set({ 
        isLocked: true, 
        savedSession: uniqueUrls,
        windowBounds: originalBounds 
    });

    createLockWindow(allWindows);
}

function createLockWindow(windowsToClose = []) {
    chrome.windows.create({
        url: chrome.runtime.getURL("lock.html"),
        type: "popup",
        width: 450,
        height: 550,
        focused: true
    }, (newWin) => {
        windowsToClose.forEach(win => {
            if (win.id !== newWin.id) {
                chrome.windows.remove(win.id).catch(() => {});
            }
        });
    });
}

// 3. Event Listeners
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return;
    chrome.storage.local.get(['isLocked'], (data) => {
        if (data.isLocked && !details.url.includes(chrome.runtime.id)) {
            lockBrowser();
        }
    });
});

chrome.runtime.onStartup.addListener(lockBrowser);
chrome.runtime.onInstalled.addListener(lockBrowser);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    if (request.action === "validatePassword") {
        if (isUnlocking) return true;
        isUnlocking = true;

        (async () => {
            try {
                const inputHash = await hashText(request.password);
                const data = await chrome.storage.local.get(['masterHash', 'savedSession', 'windowBounds']);
                
                if (data.masterHash === inputHash) {
                    await performUnlock(data);
                    sendResponse({ success: true });
                } else {
                    isUnlocking = false;
                    sendResponse({ success: false });
                }
            } catch (e) {
                isUnlocking = false;
                sendResponse({ success: false });
            }
        })();
        return true; 
    }

    if (request.action === "validateRecovery") {
        (async () => {
            const inputCodeHash = await hashText(request.recoveryCode);
            const data = await chrome.storage.local.get(['recoveryHash', 'savedSession', 'windowBounds']);

            if (data.recoveryHash === inputCodeHash) {
                await performUnlock(data);
                await chrome.storage.local.remove(['masterHash', 'recoveryHash']);
                openSetupWindow();
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false });
            }
        })();
        return true;
    }
    
    if (request.action === "manualLock") {
        lockBrowser();
        sendResponse({ success: true });
    }
});

async function performUnlock(data) {
    const dirtySession = data.savedSession || [];
    const cleanSession = [...new Set(dirtySession)];
    const bounds = data.windowBounds;

    await chrome.storage.local.set({ isLocked: false, savedSession: [] });
    
    const currentWindows = await chrome.windows.getAll();

    const winOptions = {
        url: cleanSession.length > 0 ? cleanSession : "chrome://newtab/",
        focused: true,
        type: "normal"
    };
    if (bounds) Object.assign(winOptions, bounds);

    chrome.windows.create(winOptions, (newWin) => {
        currentWindows.forEach(oldWin => {
            if (oldWin.id !== newWin.id) {
                chrome.windows.remove(oldWin.id).catch(() => {});
            }
        });
        
        setTimeout(() => {
            chrome.tabs.query({ windowId: newWin.id }, (tabs) => {
                const seenUrls = new Set();
                tabs.forEach(tab => {
                    const url = tab.pendingUrl || tab.url;
                    if (url && url.startsWith('http')) {
                        if (seenUrls.has(url)) {
                            chrome.tabs.remove(tab.id);
                        } else {
                            seenUrls.add(url);
                        }
                    }
                });
            });
        }, 500);

        setTimeout(() => { isUnlocking = false; }, 1000);
    });
}