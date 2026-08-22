#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import <atomic>
#import <thread>

#include "../keyboardEvent.h"
#include <napi.h>

static std::atomic<bool> gInterceptEnabled{false};
static std::atomic<bool> gMonitorRunning{false};
static std::atomic<bool> gSecureInputEnabled{false};
static CFMachPortRef gEventTap = nullptr;
static Napi::ThreadSafeFunction gKeyboardTsfn;
static Napi::ThreadSafeFunction gSecureInputTsfn;
static std::thread gSecureInputPollThread;

static uint32_t ReadModifierFlags(CGEventRef event) {
  CGEventFlags flags = CGEventGetFlags(event);
  uint32_t out = 0;
  if (flags & kCGEventFlagMaskShift) out |= 1;
  if (flags & kCGEventFlagMaskControl) out |= 2;
  if (flags & kCGEventFlagMaskAlternate) out |= 4;
  if (flags & kCGEventFlagMaskCommand) out |= 8;
  return out;
}

static bool IsSystemCriticalShortcut(CGEventRef event, CGEventType type) {
  if (type != kCGEventKeyDown) return false;
  CGKeyCode keyCode = static_cast<CGKeyCode>(CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode));
  CGEventFlags flags = CGEventGetFlags(event);

  if (flags & kCGEventFlagMaskCommand) {
    if (keyCode == 48) return true; // Cmd+Tab
    if (keyCode == 49) return true; // Space (Spotlight)
    return false;
  }
  if (flags & kCGEventFlagMaskControl) {
    if (keyCode == 48) return true; // Ctrl+Tab
    return false;
  }
  if (flags & kCGEventFlagMaskAlternate) {
    if (keyCode == 48) return true; // Alt+Tab
    return false;
  }
  return false;
}

static bool ShouldSuppressKeyEvent(CGEventRef event, CGEventType type) {
  if (!gInterceptEnabled.load()) return false;
  if (gSecureInputEnabled.load()) return false;
  if (type != kCGEventKeyDown) return false;
  if (IsSystemCriticalShortcut(event, type)) return false;
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

static CGEventRef KeyboardTapCallback(CGEventTapProxy proxy,
                                      CGEventType type,
                                      CGEventRef event,
                                      void* refcon) {
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    if (gEventTap) {
      CGEventTapEnable(gEventTap, true);
    }
    return event;
  }

  if (type == kCGEventKeyDown || type == kCGEventKeyUp || type == kCGEventFlagsChanged) {
    KeyboardEventPayload payload{};
    payload.type = (type == kCGEventKeyDown)
                       ? kKeyboardEventKeyDown
                       : (type == kCGEventKeyUp ? kKeyboardEventKeyUp : kKeyboardEventFlagsChanged);
    payload.keyCode = static_cast<int>(CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode));
    payload.modifiers = ReadModifierFlags(event);

    if (type == kCGEventKeyDown) {
      UniChar chars[4];
      UniCharCount len = 0;
      CGEventKeyboardGetUnicodeString(event, 4, &len, chars);
      if (len > 0 && chars[0] < 128) {
        payload.keyChar[0] = static_cast<char>(chars[0]);
      }
    }

    DispatchToJs(&payload);

    if (ShouldSuppressKeyEvent(event, type)) {
      return nullptr;
    }
  }

  return event;
}

static void SecureInputPollLoop() {
  bool lastState = false;
  while (gMonitorRunning.load()) {
    bool secure = IsSecureEventInputEnabled();
    gSecureInputEnabled.store(secure);
    if (secure != lastState && gSecureInputTsfn) {
      lastState = secure;
      bool* copy = new bool(secure);
      gSecureInputTsfn.NonBlockingCall(
          copy,
          [](Napi::Env env, Napi::Function jsCallback, bool* enabled) {
            jsCallback.Call({Napi::Boolean::New(env, *enabled)});
            delete enabled;
          });
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(250));
  }
}

bool StartPlatformGlobalKeyboardMonitor(Napi::ThreadSafeFunction tsfn) {
  if (gMonitorRunning.load()) return true;

  gKeyboardTsfn = tsfn;

  CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp) |
                     CGEventMaskBit(kCGEventFlagsChanged);

  gEventTap = CGEventTapCreate(kCGSessionEventTap,
                               kCGHeadInsertEventTap,
                               kCGEventTapOptionDefault,
                               mask,
                               KeyboardTapCallback,
                               nullptr);
  if (!gEventTap) {
    return false;
  }

  CFRunLoopSourceRef source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, gEventTap, 0);
  CFRunLoopAddSource(CFRunLoopGetMain(), source, kCFRunLoopCommonModes);
  CGEventTapEnable(gEventTap, true);
  CFRelease(source);

  gMonitorRunning.store(true);
  gSecureInputPollThread = std::thread(SecureInputPollLoop);
  return true;
}

void StopPlatformGlobalKeyboardMonitor() {
  if (!gMonitorRunning.load()) return;
  gMonitorRunning.store(false);
  if (gSecureInputPollThread.joinable()) {
    gSecureInputPollThread.join();
  }
  if (gEventTap) {
    CGEventTapEnable(gEventTap, false);
    CFRelease(gEventTap);
    gEventTap = nullptr;
  }
  if (gKeyboardTsfn) {
    gKeyboardTsfn.Release();
    gKeyboardTsfn = Napi::ThreadSafeFunction();
  }
  if (gSecureInputTsfn) {
    gSecureInputTsfn.Release();
    gSecureInputTsfn = Napi::ThreadSafeFunction();
  }
  gInterceptEnabled.store(false);
  gSecureInputEnabled.store(false);
}

void SetPlatformKeyboardInterceptEnabled(bool enabled) {
  gInterceptEnabled.store(enabled);
}

bool GetPlatformKeyboardMonitorPermissionGranted() {
  return AXIsProcessTrusted();
}

bool RequestPlatformKeyboardMonitorPermission() {
  NSDictionary* options = @{(__bridge id)kAXTrustedCheckOptionPrompt : @YES};
  return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
}

bool StartPlatformSecureInputMonitor(Napi::ThreadSafeFunction tsfn) {
  gSecureInputTsfn = tsfn;
  return true;
}

bool IsPlatformSecureInputEnabled() {
  return IsSecureEventInputEnabled();
}
