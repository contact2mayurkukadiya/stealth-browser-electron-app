#include <napi.h>

#include "keyboardEvent.h"

#if defined(__APPLE__)
extern bool SetupMacNonActivatingWindow(void* viewHandle);
extern bool TeardownMacNonActivatingWindow(void* viewHandle);
extern void SetMacGhostApplicationModeEnabled(bool enabled);
extern bool StartPlatformGlobalKeyboardMonitor(Napi::ThreadSafeFunction tsfn);
extern void StopPlatformGlobalKeyboardMonitor();
extern void SetPlatformKeyboardInterceptEnabled(bool enabled);
extern bool GetPlatformKeyboardMonitorPermissionGranted();
extern bool RequestPlatformKeyboardMonitorPermission();
extern bool StartPlatformSecureInputMonitor(Napi::ThreadSafeFunction tsfn);
extern bool IsPlatformSecureInputEnabled();
#elif defined(_WIN32)
extern bool SetupWindowsNonActivatingWindow(void* hwnd);
extern bool TeardownWindowsNonActivatingWindow(void* hwnd);
extern void SetWindowsGhostApplicationModeEnabled(bool enabled);
extern bool StartPlatformGlobalKeyboardMonitor(Napi::ThreadSafeFunction tsfn);
extern void StopPlatformGlobalKeyboardMonitor();
extern void SetPlatformKeyboardInterceptEnabled(bool enabled);
extern bool GetPlatformKeyboardMonitorPermissionGranted();
extern bool RequestPlatformKeyboardMonitorPermission();
extern bool StartPlatformSecureInputMonitor(Napi::ThreadSafeFunction tsfn);
extern bool IsPlatformSecureInputEnabled();
#endif

static Napi::ThreadSafeFunction gKeyboardCallback;
static Napi::ThreadSafeFunction gSecureInputCallback;

static void* ReadNativeHandle(const Napi::CallbackInfo& info, Napi::Env env) {
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected native window handle Buffer")
        .ThrowAsJavaScriptException();
    return nullptr;
  }

  Napi::Buffer<uint8_t> handleBuffer = info[0].As<Napi::Buffer<uint8_t>>();
  if (handleBuffer.Length() < sizeof(void*)) {
    Napi::TypeError::New(env, "Native window handle Buffer is too small")
        .ThrowAsJavaScriptException();
    return nullptr;
  }

  void* handle = *reinterpret_cast<void**>(handleBuffer.Data());
  if (handle == nullptr) {
    Napi::Error::New(env, "Native window handle is null")
        .ThrowAsJavaScriptException();
    return nullptr;
  }

  return handle;
}

Napi::Value SetupNonActivatingWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  void* handle = ReadNativeHandle(info, env);
  if (handle == nullptr) return env.Null();

  bool ok = false;
#if defined(__APPLE__)
  ok = SetupMacNonActivatingWindow(handle);
#elif defined(_WIN32)
  ok = SetupWindowsNonActivatingWindow(handle);
#endif

  return Napi::Boolean::New(env, ok);
}

Napi::Value TeardownNonActivatingWindow(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  void* handle = ReadNativeHandle(info, env);
  if (handle == nullptr) return env.Null();

  bool ok = false;
#if defined(__APPLE__)
  ok = TeardownMacNonActivatingWindow(handle);
#elif defined(_WIN32)
  ok = TeardownWindowsNonActivatingWindow(handle);
#endif

  return Napi::Boolean::New(env, ok);
}

Napi::Value SetGhostApplicationModeEnabled(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) {
    Napi::TypeError::New(env, "Expected boolean ghost application mode flag")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  const bool enabled = info[0].As<Napi::Boolean>().Value();
#if defined(__APPLE__)
  SetMacGhostApplicationModeEnabled(enabled);
#elif defined(_WIN32)
  SetWindowsGhostApplicationModeEnabled(enabled);
#endif
  return env.Undefined();
}

Napi::Value StartGlobalKeyboardMonitor(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected keyboard callback function")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

#if defined(__APPLE__) || defined(_WIN32)
  if (gKeyboardCallback) {
    gKeyboardCallback.Release();
  }

  gKeyboardCallback = Napi::ThreadSafeFunction::New(
      env,
      info[0].As<Napi::Function>(),
      "InviSurfKeyboardMonitor",
      0,
      1);

  bool ok = StartPlatformGlobalKeyboardMonitor(gKeyboardCallback);
  return Napi::Boolean::New(env, ok);
#else
  return Napi::Boolean::New(env, false);
#endif
}

Napi::Value StopGlobalKeyboardMonitor(const Napi::CallbackInfo& info) {
#if defined(__APPLE__) || defined(_WIN32)
  StopPlatformGlobalKeyboardMonitor();
  if (gKeyboardCallback) {
    gKeyboardCallback.Release();
    gKeyboardCallback = Napi::ThreadSafeFunction();
  }
#endif
  return info.Env().Undefined();
}

Napi::Value SetKeyboardInterceptEnabled(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBoolean()) {
    Napi::TypeError::New(env, "Expected boolean intercept flag")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
#if defined(__APPLE__) || defined(_WIN32)
  SetPlatformKeyboardInterceptEnabled(info[0].As<Napi::Boolean>().Value());
#endif
  return env.Undefined();
}

Napi::Value GetKeyboardMonitorPermissionGranted(const Napi::CallbackInfo& info) {
#if defined(__APPLE__) || defined(_WIN32)
  return Napi::Boolean::New(info.Env(), GetPlatformKeyboardMonitorPermissionGranted());
#else
  return Napi::Boolean::New(info.Env(), false);
#endif
}

Napi::Value RequestKeyboardMonitorPermission(const Napi::CallbackInfo& info) {
#if defined(__APPLE__) || defined(_WIN32)
  return Napi::Boolean::New(info.Env(), RequestPlatformKeyboardMonitorPermission());
#else
  return Napi::Boolean::New(info.Env(), false);
#endif
}

Napi::Value OnSecureInputChanged(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected secure-input callback function")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

#if defined(__APPLE__)
  if (gSecureInputCallback) {
    gSecureInputCallback.Release();
  }
  gSecureInputCallback = Napi::ThreadSafeFunction::New(
      env,
      info[0].As<Napi::Function>(),
      "InviSurfSecureInputMonitor",
      0,
      1);
  StartPlatformSecureInputMonitor(gSecureInputCallback);
#endif
  return env.Undefined();
}

Napi::Value IsSecureInputEnabled(const Napi::CallbackInfo& info) {
#if defined(__APPLE__) || defined(_WIN32)
  return Napi::Boolean::New(info.Env(), IsPlatformSecureInputEnabled());
#else
  return Napi::Boolean::New(info.Env(), false);
#endif
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setupNonActivatingWindow",
              Napi::Function::New(env, SetupNonActivatingWindow));
  exports.Set("teardownNonActivatingWindow",
              Napi::Function::New(env, TeardownNonActivatingWindow));
  exports.Set("setGhostApplicationModeEnabled",
              Napi::Function::New(env, SetGhostApplicationModeEnabled));
  exports.Set("startGlobalKeyboardMonitor",
              Napi::Function::New(env, StartGlobalKeyboardMonitor));
  exports.Set("stopGlobalKeyboardMonitor",
              Napi::Function::New(env, StopGlobalKeyboardMonitor));
  exports.Set("setKeyboardInterceptEnabled",
              Napi::Function::New(env, SetKeyboardInterceptEnabled));
  exports.Set("getKeyboardMonitorPermissionGranted",
              Napi::Function::New(env, GetKeyboardMonitorPermissionGranted));
  exports.Set("requestKeyboardMonitorPermission",
              Napi::Function::New(env, RequestKeyboardMonitorPermission));
  exports.Set("onSecureInputChanged",
              Napi::Function::New(env, OnSecureInputChanged));
  exports.Set("isSecureInputEnabled",
              Napi::Function::New(env, IsSecureInputEnabled));
  return exports;
}

NODE_API_MODULE(invisurf_non_activating, Init)
