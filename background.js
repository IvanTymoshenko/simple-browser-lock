/**
 * Simple Browser Lock - Background Service Worker
 */

// --- Constants & Config ---
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
let isUnlocking = false;

// --- Utility: SHA-256 Hash Function ---
async function hashText(text) {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Feature: Smart Setup Reminder ---
async function checkSetupNeeded() {
    const data = await chrome.storage.local.get(['masterHash', 'nextReminder']);
    
    // If password exists, no reminder needed.
    if (data.masterHash) return;

    const now = Date.now();
    // Remind if never reminded OR if last reminder was > 7 days ago
    if (!data.nextReminder || now > data.nextReminder) {
        openSetupWindow();
        await chrome.storage.local.set({ nextReminder: now + SEVEN_DAYS_MS });
    }
}

function openSetupWindow() {
    chrome.tabs.query({}, (tabs) => {
        // Prevent opening multiple setup windows
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

// --- Core Logic: Locking the Browser ---
async function lockBrowser() {
    const data = await chrome.storage.local.get(['masterHash', 'isLocked', 'savedSession']);
    
    // If no password is set, check if we need to remind the user instead of locking
    if (!data.masterHash) {
        checkSetupNeeded();
        return;
    }

    const allWindows = await chrome.windows.getAll({ populate: true });

    // Scenario 1: Already Locked - Maintain the Lock Window
    if (data.isLocked) {
        const existingLockWindow = allWindows.find(win => 
            win.tabs.some(tab => tab.url.includes("lock.html"))
        );

        allWindows.forEach(win => {
            // Keep the lock window, close everything else
            if (existingLockWindow && win.id === existingLockWindow.id) return;
            chrome.windows.remove(win.id).catch(() => {});
        });

        if (existingLockWindow) {
            chrome.windows.update(existingLockWindow.id, { focused: true });
        } else {
            createLockWindow();
        }
        return;
    }

    // Scenario 2: Fresh Lock - Save Session and Close Windows
    let rawUrls = [];
    let originalBounds = null;

    if (allWindows.length > 0) {
        // Capture window size to restore later
        const normalWin = allWindows.find(w => w.type === 'normal') || allWindows[0];
        originalBounds = {
            width: normalWin.width,
            height: normalWin.height,
            top: normalWin.top,
            left: normalWin.left
        };

        // Capture all open tabs (excluding internal pages)
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

    // Remove duplicates
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
        // Close old windows after the lock screen is safely created
        windowsToClose.forEach(win => {
            if (win.id !== newWin.id) {
                chrome.windows.remove(win.id).catch(() => {});
            }
        });
    });
}

// --- Helper: Unlocking ---
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
        // Close the lock screen
        currentWindows.forEach(oldWin => {
            if (oldWin.id !== newWin.id) {
                chrome.windows.remove(oldWin.id).catch(() => {});
            }
        });
        
        // Clean up any duplicate tabs that might have spawned (500ms delay)
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

// --- Event Listeners ---

// 1. Navigation Guard
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return;
    chrome.storage.local.get(['isLocked'], (data) => {
        if (data.isLocked && !details.url.includes(chrome.runtime.id)) {
            lockBrowser();
        }
    });
});

// 2. Startup & Installation
chrome.runtime.onStartup.addListener(lockBrowser);
chrome.runtime.onInstalled.addListener(lockBrowser);

// 3. Message Handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // Validate Password
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

    // Validate Recovery Code
    if (request.action === "validateRecovery") {
        (async () => {
            const inputCodeHash = await hashText(request.recoveryCode);
            const data = await chrome.storage.local.get(['recoveryHash', 'savedSession', 'windowBounds']);

            if (data.recoveryHash === inputCodeHash) {
                await performUnlock(data);
                // Reset credentials so user must set new ones
                await chrome.storage.local.remove(['masterHash', 'recoveryHash']);
                openSetupWindow();
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false });
            }
        })();
        return true;
    }
    
    // Manual Lock Trigger
    if (request.action === "manualLock") {
        lockBrowser();
        sendResponse({ success: true });
    }
});