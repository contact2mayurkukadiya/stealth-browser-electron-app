#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#import <atomic>
#import <unordered_set>

static IMP gOriginalCanBecomeKeyWindowImp = nullptr;
static IMP gOriginalCanBecomeMainWindowImp = nullptr;
static IMP gOriginalAcceptsFirstMouseImp = nullptr;
static IMP gOriginalMakeKeyWindowImp = nullptr;
static IMP gOriginalMakeKeyAndOrderFrontImp = nullptr;
static IMP gOriginalMakeMainWindowImp = nullptr;
static IMP gOriginalActivateIgnoringOtherAppsImp = nullptr;
static IMP gOriginalActivateImp = nullptr;
static IMP gOriginalActivateWithOptionsImp = nullptr;
static IMP gOriginalRunningAppActivateWithOptionsImp = nullptr;
static std::atomic<bool> gGhostApplicationMode{false};
static std::unordered_set<void*> gConfiguredWindows;

static BOOL IsConfiguredGhostWindow(id self) {
  return gConfiguredWindows.count((__bridge void*)self) > 0;
}

static BOOL InvisurfCanBecomeKeyWindow(id self, SEL _cmd) {
  if (IsConfiguredGhostWindow(self)) {
    return NO;
  }
  if (gOriginalCanBecomeKeyWindowImp != nullptr) {
    return ((BOOL (*)(id, SEL))gOriginalCanBecomeKeyWindowImp)(self, _cmd);
  }
  return YES;
}

static BOOL InvisurfCanBecomeMainWindow(id self, SEL _cmd) {
  if (IsConfiguredGhostWindow(self)) {
    return NO;
  }
  if (gOriginalCanBecomeMainWindowImp != nullptr) {
    return ((BOOL (*)(id, SEL))gOriginalCanBecomeMainWindowImp)(self, _cmd);
  }
  return YES;
}

static BOOL InvisurfAcceptsFirstMouse(id self, SEL _cmd, NSEvent* event) {
  if (IsConfiguredGhostWindow(self)) {
    return YES;
  }
  if (gOriginalAcceptsFirstMouseImp != nullptr) {
    return ((BOOL (*)(id, SEL, NSEvent*))gOriginalAcceptsFirstMouseImp)(self, _cmd, event);
  }
  return NO;
}

static void InvisurfMakeKeyWindow(id self, SEL _cmd) {
  if (IsConfiguredGhostWindow(self)) {
    return;
  }
  if (gOriginalMakeKeyWindowImp != nullptr) {
    ((void (*)(id, SEL))gOriginalMakeKeyWindowImp)(self, _cmd);
  }
}

static void InvisurfMakeKeyAndOrderFront(id self, SEL _cmd, id sender) {
  if (IsConfiguredGhostWindow(self)) {
    [(NSWindow*)self orderFront:sender];
    return;
  }
  if (gOriginalMakeKeyAndOrderFrontImp != nullptr) {
    ((void (*)(id, SEL, id))gOriginalMakeKeyAndOrderFrontImp)(self, _cmd, sender);
  }
}

static void InvisurfMakeMainWindow(id self, SEL _cmd) {
  if (IsConfiguredGhostWindow(self)) {
    return;
  }
  if (gOriginalMakeMainWindowImp != nullptr) {
    ((void (*)(id, SEL))gOriginalMakeMainWindowImp)(self, _cmd);
  }
}

static void InvisurfActivateIgnoringOtherApps(id self, SEL _cmd, BOOL flag) {
  if (gGhostApplicationMode.load()) {
    return;
  }
  if (gOriginalActivateIgnoringOtherAppsImp != nullptr) {
    ((void (*)(id, SEL, BOOL))gOriginalActivateIgnoringOtherAppsImp)(self, _cmd, flag);
  }
}

static void InvisurfActivate(id self, SEL _cmd) {
  if (gGhostApplicationMode.load()) {
    return;
  }
  if (gOriginalActivateImp != nullptr) {
    ((void (*)(id, SEL))gOriginalActivateImp)(self, _cmd);
  }
}

static void InvisurfActivateWithOptions(id self, SEL _cmd, NSApplicationActivationOptions options) {
  if (gGhostApplicationMode.load()) {
    return;
  }
  if (gOriginalActivateWithOptionsImp != nullptr) {
    ((void (*)(id, SEL, NSApplicationActivationOptions))gOriginalActivateWithOptionsImp)(self, _cmd,
                                                                                          options);
  }
}

static BOOL InvisurfRunningAppActivateWithOptions(id self,
                                                  SEL _cmd,
                                                  NSApplicationActivationOptions options) {
  if (gGhostApplicationMode.load()) {
    NSRunningApplication* app = (NSRunningApplication*)self;
    if ([app isEqual:[NSRunningApplication currentApplication]]) {
      return NO;
    }
  }
  if (gOriginalRunningAppActivateWithOptionsImp != nullptr) {
    return ((BOOL (*)(id, SEL,
                       NSApplicationActivationOptions))gOriginalRunningAppActivateWithOptionsImp)(
        self, _cmd, options);
  }
  return NO;
}

static void SwizzleInstanceMethod(Class cls, SEL selector, IMP replacement, IMP* originalOut) {
  Method method = class_getInstanceMethod(cls, selector);
  if (method == nullptr) {
    return;
  }
  if (*originalOut == nullptr) {
    *originalOut = method_getImplementation(method);
  }
  method_setImplementation(method, replacement);
}

static void EnsureApplicationSwizzles() {
  SwizzleInstanceMethod([NSApplication class], @selector(activateIgnoringOtherApps:),
                        (IMP)InvisurfActivateIgnoringOtherApps,
                        &gOriginalActivateIgnoringOtherAppsImp);
  SwizzleInstanceMethod([NSApplication class], @selector(activate), (IMP)InvisurfActivate,
                        &gOriginalActivateImp);
  if (@available(macOS 14.0, *)) {
    SwizzleInstanceMethod([NSApplication class], @selector(activateWithOptions:),
                          (IMP)InvisurfActivateWithOptions, &gOriginalActivateWithOptionsImp);
  }
  SwizzleInstanceMethod([NSRunningApplication class], @selector(activateWithOptions:),
                        (IMP)InvisurfRunningAppActivateWithOptions,
                        &gOriginalRunningAppActivateWithOptionsImp);
}

static void EnsureGhostWindowSwizzles() {
  EnsureApplicationSwizzles();
  SwizzleInstanceMethod([NSWindow class], @selector(canBecomeKeyWindow),
                        (IMP)InvisurfCanBecomeKeyWindow, &gOriginalCanBecomeKeyWindowImp);
  SwizzleInstanceMethod([NSWindow class], @selector(canBecomeMainWindow),
                        (IMP)InvisurfCanBecomeMainWindow, &gOriginalCanBecomeMainWindowImp);
  SwizzleInstanceMethod([NSWindow class], @selector(acceptsFirstMouse:),
                        (IMP)InvisurfAcceptsFirstMouse, &gOriginalAcceptsFirstMouseImp);
  SwizzleInstanceMethod([NSWindow class], @selector(makeKeyWindow),
                        (IMP)InvisurfMakeKeyWindow, &gOriginalMakeKeyWindowImp);
  SwizzleInstanceMethod([NSWindow class], @selector(makeKeyAndOrderFront:),
                        (IMP)InvisurfMakeKeyAndOrderFront, &gOriginalMakeKeyAndOrderFrontImp);
  SwizzleInstanceMethod([NSWindow class], @selector(makeMainWindow), (IMP)InvisurfMakeMainWindow,
                        &gOriginalMakeMainWindowImp);
}

void SetMacGhostApplicationModeEnabled(bool enabled) {
  gGhostApplicationMode.store(enabled);
  EnsureApplicationSwizzles();
}

bool SetupMacNonActivatingWindow(void* viewHandle) {
  if (viewHandle == nullptr) {
    return false;
  }

  @autoreleasepool {
    NSView* view = (__bridge NSView*)viewHandle;
    if (view == nil) {
      return false;
    }

    NSWindow* window = [view window];
    if (window == nil) {
      return false;
    }

    EnsureGhostWindowSwizzles();
    gConfiguredWindows.insert((__bridge void*)window);

    NSWindowStyleMask styleMask = [window styleMask];
    styleMask |= NSWindowStyleMaskNonactivatingPanel;
    [window setStyleMask:styleMask];

    if ([window respondsToSelector:@selector(setHidesOnDeactivate:)]) {
      [window setHidesOnDeactivate:NO];
    }

    return true;
  }
}

bool TeardownMacNonActivatingWindow(void* viewHandle) {
  if (viewHandle == nullptr) {
    return false;
  }

  @autoreleasepool {
    NSView* view = (__bridge NSView*)viewHandle;
    if (view == nil) {
      return false;
    }

    NSWindow* window = [view window];
    if (window == nil) {
      return false;
    }

    gConfiguredWindows.erase((__bridge void*)window);

    NSWindowStyleMask styleMask = [window styleMask];
    styleMask &= ~NSWindowStyleMaskNonactivatingPanel;
    [window setStyleMask:styleMask];

    return true;
  }
}
