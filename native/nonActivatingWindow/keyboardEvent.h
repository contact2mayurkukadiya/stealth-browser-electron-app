#pragma once

#include <stdint.h>

enum KeyboardEventType : int {
  kKeyboardEventKeyDown = 0,
  kKeyboardEventKeyUp = 1,
  kKeyboardEventFlagsChanged = 2,
};

struct KeyboardEventPayload {
  int type;
  int keyCode;
  uint32_t modifiers;
  char keyChar[8];
};
