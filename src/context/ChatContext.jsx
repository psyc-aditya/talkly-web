import { createContext, useContext, useReducer } from "react";
import { useAuth } from "./AuthContext";

const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
  const { currentUser } = useAuth();
  const INITIAL_STATE = {
    chatId: "null",
    user: {},
    isMobileView: false,
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
          };
        }
        return {
          ...state,
          user: action.payload,
          chatId: [currentUser.uid, action.payload.uid].sort().join("_"),
          isMobileView: true,
        };
      case "BACK_TO_SIDEBAR":
        return {
          ...state,
          isMobileView: false,
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
