#include <windows.h>
#include <atomic>
#include <unordered_map>

static std::unordered_map<HWND, WNDPROC> gOriginalWndProcs;
static std::atomic<bool> gGhostApplicationMode{false};

static bool IsConfiguredGhostWindow(HWND hwnd) {
  return gOriginalWndProcs.find(hwnd) != gOriginalWndProcs.end();
}

static LRESULT CALLBACK NonActivatingWndProc(HWND hwnd,
                                             UINT msg,
                                             WPARAM wParam,
                                             LPARAM lParam) {
  if (msg == WM_MOUSEACTIVATE) {
    return MA_NOACTIVATE;
  }

  if (msg == WM_NCACTIVATE) {
    // Prevent title bar / frame clicks from activating the window.
    if (wParam != FALSE) {
      return TRUE;
    }
  }

  if (gGhostApplicationMode.load() && IsConfiguredGhostWindow(hwnd)) {
    if (msg == WM_ACTIVATE) {
      const WORD activationState = LOWORD(wParam);
      if (activationState != WA_INACTIVE) {
        return 0;
      }
    }

    if (msg == WM_SETFOCUS) {
      return 0;
    }
  }

  auto it = gOriginalWndProcs.find(hwnd);
  if (it != gOriginalWndProcs.end() && it->second != nullptr) {
    return CallWindowProc(it->second, hwnd, msg, wParam, lParam);
  }

  return DefWindowProc(hwnd, msg, wParam, lParam);
}

void SetWindowsGhostApplicationModeEnabled(bool enabled) {
  gGhostApplicationMode.store(enabled);
}

bool SetupWindowsNonActivatingWindow(void* hwndPtr) {
  if (hwndPtr == nullptr) {
    return false;
  }

  HWND hwnd = static_cast<HWND>(hwndPtr);
  if (!IsWindow(hwnd)) {
    return false;
  }

  LONG_PTR exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
  exStyle |= WS_EX_NOACTIVATE;
  SetWindowLongPtr(hwnd, GWL_EXSTYLE, exStyle);

  if (gOriginalWndProcs.find(hwnd) == gOriginalWndProcs.end()) {
    WNDPROC originalProc = reinterpret_cast<WNDPROC>(
        GetWindowLongPtr(hwnd, GWLP_WNDPROC));
    if (originalProc == nullptr) {
      return false;
    }

    gOriginalWndProcs[hwnd] = originalProc;
    SetWindowLongPtr(hwnd, GWLP_WNDPROC,
                     reinterpret_cast<LONG_PTR>(NonActivatingWndProc));
  }

  SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
               SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE |
                   SWP_FRAMECHANGED);

  return true;
}

bool TeardownWindowsNonActivatingWindow(void* hwndPtr) {
  if (hwndPtr == nullptr) {
    return false;
  }

  HWND hwnd = static_cast<HWND>(hwndPtr);
  if (!IsWindow(hwnd)) {
    return false;
  }

  auto it = gOriginalWndProcs.find(hwnd);
  if (it != gOriginalWndProcs.end()) {
    SetWindowLongPtr(hwnd, GWLP_WNDPROC,
                     reinterpret_cast<LONG_PTR>(it->second));
    gOriginalWndProcs.erase(it);
  }

  LONG_PTR exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
  exStyle &= ~WS_EX_NOACTIVATE;
  SetWindowLongPtr(hwnd, GWL_EXSTYLE, exStyle);

  SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
               SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE |
                   SWP_FRAMECHANGED);

  return true;
}
