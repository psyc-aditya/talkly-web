import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const ContextMenuContext = createContext({
  openContextMenu: () => {},
  closeContextMenu: () => {},
  isOpen: false,
});

export function useContextMenu() {
  return useContext(ContextMenuContext);
}

export function ContextMenuProvider({ children }) {
  const [menuState, setMenuState] = useState(null);
  const [coords, setCoords] = useState({ left: 0, top: 0, ready: false });
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const menuRef = useRef(null);

  const closeContextMenu = useCallback(() => {
    setMenuState(null);
    setFocusedIndex(-1);
  }, []);

  const openContextMenu = useCallback(({ x, y, header = null, items = [] }) => {
    const cleaned = [];
    for (const item of items) {
      if (!item || item.hidden) continue;
      if (item.type === "divider") {
        if (cleaned.length > 0 && cleaned[cleaned.length - 1].type !== "divider") {
          cleaned.push(item);
        }
      } else {
        cleaned.push(item);
      }
    }
    while (cleaned.length > 0 && cleaned[cleaned.length - 1].type === "divider") {
      cleaned.pop();
    }
    if (cleaned.length === 0) return;

    setCoords({ left: x, top: y, ready: false });
    setFocusedIndex(-1);
    setMenuState({ x, y, header, items: cleaned });
  }, []);

  // Clamp menu within viewport bounds after measuring its rendered dimensions
  useLayoutEffect(() => {
    if (!menuState || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const padding = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let nextLeft = menuState.x;
    let nextTop = menuState.y;

    if (nextLeft + rect.width + padding > vw) {
      nextLeft = Math.max(padding, vw - rect.width - padding);
    }
    if (nextTop + rect.height + padding > vh) {
      nextTop = Math.max(padding, menuState.y - rect.height);
      if (nextTop + rect.height + padding > vh) {
        nextTop = Math.max(padding, vh - rect.height - padding);
      }
    }

    setCoords({ left: Math.max(padding, nextLeft), top: Math.max(padding, nextTop), ready: true });
  }, [menuState]);

  // Dismiss on outside click, Escape, scroll, or resize; support Arrow/Enter navigation
  useEffect(() => {
    if (!menuState) return;

    const actionableIndices = menuState.items
      .map((item, idx) => (item.type !== "divider" && !item.disabled ? idx : -1))
      .filter((idx) => idx !== -1);

    const handleMouseDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      closeContextMenu();
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeContextMenu();
        return;
      }
      if (actionableIndices.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const pos = actionableIndices.indexOf(prev);
          return actionableIndices[(pos + 1) % actionableIndices.length];
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const pos = actionableIndices.indexOf(prev);
          if (pos <= 0) return actionableIndices[actionableIndices.length - 1];
          return actionableIndices[pos - 1];
        });
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        const item = menuState.items[focusedIndex];
        if (item && !item.disabled && typeof item.onClick === "function") {
          closeContextMenu();
          item.onClick();
        }
      }
    };

    const handleWindowChange = () => closeContextMenu();

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [menuState, focusedIndex, closeContextMenu]);

  return (
    <ContextMenuContext.Provider
      value={{
        openContextMenu,
        closeContextMenu,
        isOpen: Boolean(menuState),
      }}
    >
      {children}
      {menuState &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onContextMenu={(e) => e.preventDefault()}
            style={{
              position: "fixed",
              left: `${coords.left}px`,
              top: `${coords.top}px`,
              visibility: coords.ready ? "visible" : "hidden",
            }}
            className="z-[9999] min-w-[210px] max-w-[260px] rounded-xl bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border border-gray-200/90 dark:border-gray-800 shadow-2xl py-1.5 select-none animate-context-menu"
          >
            {menuState.header && (
              <div className="px-3 py-2 mb-1 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2.5 min-w-0">
                {menuState.header.avatar && (
                  <img
                    src={menuState.header.avatar}
                    alt=""
                    className="w-7 h-7 rounded-full object-cover shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  {menuState.header.title && (
                    <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {menuState.header.title}
                    </p>
                  )}
                  {menuState.header.subtitle && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {menuState.header.subtitle}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="px-1.5 space-y-0.5">
              {menuState.items.map((item, idx) => {
                if (item.type === "divider") {
                  return (
                    <div
                      key={`div-${idx}`}
                      role="separator"
                      className="my-1.5 mx-1.5 h-px bg-gray-100 dark:bg-gray-800"
                    />
                  );
                }

                const Icon = item.icon;
                const isFocused = focusedIndex === idx;

                return (
                  <button
                    key={item.id || `${item.label}-${idx}`}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onMouseEnter={() => setFocusedIndex(idx)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (item.disabled) return;
                      closeContextMenu();
                      item.onClick?.();
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors text-left whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed ${
                      item.danger
                        ? isFocused
                          ? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                          : "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                        : isFocused
                        ? "bg-blue-50/80 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                        : "text-gray-700 dark:text-gray-200 hover:bg-blue-50/80 dark:hover:bg-gray-800"
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      {Icon && (
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            item.danger
                              ? "text-red-500 dark:text-red-400"
                              : item.active
                              ? "text-blue-600 dark:text-sky-400"
                              : "text-gray-500 dark:text-gray-400"
                          }`}
                        />
                      )}
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.hint && (
                      <span className="text-[11px] text-gray-400 dark:text-gray-500 font-normal shrink-0">
                        {item.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </ContextMenuContext.Provider>
  );
}
