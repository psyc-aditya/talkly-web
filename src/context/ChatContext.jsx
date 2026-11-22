import { createContext, useContext, useReducer } from "react";
import { useAuth } from "./AuthContext";

const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
  const { currentUser } = useAuth();
  const INITIAL_STATE = {
    chatId: "null",
    user: {},
    isMobileView: false,
    pendingSearch: "",
    showSettings: false,
    settingsSection: "general",
  };

  const chatReducer = (state, action) => {
    switch (action.type) {
      case "CHANGE_USER":
        if (!action.payload) {
          return {
            ...state,
            user: {},
            chatId: "null",
            isMobileView: false,
            showSettings: false,
          };
        }
        return {
          ...state,
          user: action.payload,
          chatId: [currentUser.uid, action.payload.uid].sort().join("_"),
          isMobileView: true,
          showSettings: false,
        };
      case "OPEN_SETTINGS":
        return {
          ...state,
          showSettings: true,
          settingsSection: action.payload || state.settingsSection || "general",
          isMobileView: true,
        };
      case "SET_SETTINGS_SECTION":
        return {
          ...state,
          settingsSection: action.payload || "general",
        };
      case "CLOSE_SETTINGS":
        return {
          ...state,
          showSettings: false,
          isMobileView: false,
        };
      case "BACK_TO_SIDEBAR":
        return {
          ...state,
          isMobileView: false,
          showSettings: false,
        };
      case "SET_PENDING_SEARCH":
        return {
          ...state,
          pendingSearch: action.payload || "",
          isMobileView: false,
          showSettings: false,
        };
      case "CLEAR_PENDING_SEARCH":
        return {
          ...state,
          pendingSearch: "",
        };
      default:
        return state;
    }
  };

  const [state, dispatch] = useReducer(chatReducer, INITIAL_STATE);

  return (
    <ChatContext.Provider value={{ data: state, dispatch }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => useContext(ChatContext);
