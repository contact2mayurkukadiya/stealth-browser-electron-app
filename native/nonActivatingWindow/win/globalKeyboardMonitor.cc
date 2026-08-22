#include "../keyboardEvent.h"
#include <napi.h>

#include <atomic>
#include <windows.h>

static std::atomic<bool> gInterceptEnabled{false};
static std::atomic<bool> gMonitorRunning{false};
static HHOOK gKeyboardHook = nullptr;
static Napi::ThreadSafeFunction gKeyboardTsfn;
static DWORD gHookThreadId = 0;
static HANDLE gHookThread = nullptr;

static uint32_t ReadModifierFlags() {
  uint32_t out = 0;
  if (GetAsyncKeyState(VK_SHIFT) & 0x8000) out |= 1;
  if (GetAsyncKeyState(VK_CONTROL) & 0x8000) out |= 2;
  if (GetAsyncKeyState(VK_MENU) & 0x8000) out |= 4;
  if ((GetAsyncKeyState(VK_LWIN) & 0x8000) || (GetAsyncKeyState(VK_RWIN) & 0x8000)) out |= 8;
  return out;
}

static bool IsSystemCriticalShortcut(DWORD vk) {
  if ((GetAsyncKeyState(VK_LWIN) & 0x8000) || (GetAsyncKeyState(VK_RWIN) & 0x8000)) {
    if (vk == VK_TAB) return true;
    if (vk == 'L') return true;
    return false;
  }
  if (GetAsyncKeyState(VK_MENU) & 0x8000) {
    if (vk == VK_TAB) return true;
    return false;
  }
  if (GetAsyncKeyState(VK_CONTROL) & 0x8000) {
    if (vk == VK_TAB) return true;
    if (vk == VK_ESCAPE) return true;
    return false;
  }
  return false;
}

static bool ShouldSuppressKeyEvent(DWORD vk, bool isKeyDown) {
  if (!gInterceptEnabled.load()) return false;
  if (!isKeyDown) return false;
  if (IsSystemCriticalShortcut(vk)) return false;
  return true;
}

static void DispatchToJs(KeyboardEventPayload* payload) {
  if (!gKeyboardTsfn) return;
  KeyboardEventPayload* copy = new KeyboardEventPayload(*payload);
  gKeyboardTsfn.NonBlockingCall(
      copy,
      [](Napi::Env env, Napi::Function jsCallback, KeyboardEventPayload* data) {
        Napi::Object obj = Napi::Object::New(env);
        const char* typeName = "keyDown";
        if (data->type == kKeyboardEventKeyUp) typeName = "keyUp";
        else if (data->type == kKeyboardEventFlagsChanged) typeName = "flagsChanged";
        obj.Set("type", Napi::String::New(env, typeName));
        obj.Set("keyCode", Napi::Number::New(env, data->keyCode));
        Napi::Object mods = Napi::Object::New(env);
        mods.Set("shift", Napi::Boolean::New(env, !!(data->modifiers & 1)));
        mods.Set("ctrl", Napi::Boolean::New(env, !!(data->modifiers & 2)));
        mods.Set("alt", Napi::Boolean::New(env, !!(data->modifiers & 4)));
        mods.Set("meta", Napi::Boolean::New(env, !!(data->modifiers & 8)));
        obj.Set("modifiers", mods);
        if (data->keyChar[0] != '\0') {
          obj.Set("key", Napi::String::New(env, data->keyChar));
        }
        jsCallback.Call({obj});
        delete data;
      });
}

static LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode == HC_ACTION) {
    const KBDLLHOOKSTRUCT* kb = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
    const bool isKeyDown = (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN);
    const bool isKeyUp = (wParam == WM_KEYUP || wParam == WM_SYSKEYUP);

    if (isKeyDown || isKeyUp) {
      KeyboardEventPayload payload{};
      payload.type = isKeyDown ? kKeyboardEventKeyDown : kKeyboardEventKeyUp;
      payload.keyCode = static_cast<int>(kb->vkCode);
      payload.modifiers = ReadModifierFlags();

      if (isKeyDown && kb->vkCode >= 0x20 && kb->vkCode <= 0x7E) {
        payload.keyChar[0] = static_cast<char>(kb->vkCode);
      }

      DispatchToJs(&payload);

      if (ShouldSuppressKeyEvent(kb->vkCode, isKeyDown)) {
        return 1;
      }
    }
  }
  return CallNextHookEx(gKeyboardHook, nCode, wParam, lParam);
}

static DWORD WINAPI HookThreadMain(LPVOID) {
  gKeyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, LowLevelKeyboardProc, GetModuleHandleW(nullptr), 0);
  if (!gKeyboardHook) return 1;

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  if (gKeyboardHook) {
    UnhookWindowsHookEx(gKeyboardHook);
    gKeyboardHook = nullptr;
  }
  return 0;
}

bool StartPlatformGlobalKeyboardMonitor(Napi::ThreadSafeFunction tsfn) {
  if (gMonitorRunning.load()) return true;
  gKeyboardTsfn = tsfn;

  gHookThread = CreateThread(nullptr, 0, HookThreadMain, nullptr, 0, &gHookThreadId);
  if (!gHookThread) return false;

  gMonitorRunning.store(true);
  return true;
}

void StopPlatformGlobalKeyboardMonitor() {
  if (!gMonitorRunning.load()) return;
  if (gHookThreadId) {
    PostThreadMessageW(gHookThreadId, WM_QUIT, 0, 0);
  }
  if (gHookThread) {
    WaitForSingleObject(gHookThread, 2000);
    CloseHandle(gHookThread);
    gHookThread = nullptr;
    gHookThreadId = 0;
  }
  if (gKeyboardTsfn) {
    gKeyboardTsfn.Release();
    gKeyboardTsfn = Napi::ThreadSafeFunction();
  }
  gMonitorRunning.store(false);
  gInterceptEnabled.store(false);
}

void SetPlatformKeyboardInterceptEnabled(bool enabled) {
  gInterceptEnabled.store(enabled);
}

bool GetPlatformKeyboardMonitorPermissionGranted() {
  return true;
}

bool RequestPlatformKeyboardMonitorPermission() {
  return true;
}

bool StartPlatformSecureInputMonitor(Napi::ThreadSafeFunction) {
  return true;
}

bool IsPlatformSecureInputEnabled() {
  return false;
}
