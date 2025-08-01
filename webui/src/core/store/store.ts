import { create } from "zustand";

import { type ChatEvent, chatStream } from "../api";
import { mockChatStream } from "../api/mock";
import {
  type WorkflowMessage,
  type Message,
  type TextMessage,
} from "../messaging";
import { clone } from "../utils";
import { WorkflowEngine } from "../workflow";

export const useStore = create<{
  messages: Message[];
  responding: boolean;
  state: {
    messages: { role: string; content: string }[];
  };
}>(() => ({
  messages: [],
  responding: false,
  state: {
    messages: [],
  },
}));

export function addMessage(message: Message) {
  useStore.setState((state) => ({ messages: [...state.messages, message] }));
  return message;
}

export function updateMessage(message: Partial<Message> & { id: string }) {
  useStore.setState((state) => {
    const index = state.messages.findIndex((m) => m.id === message.id);
    if (index === -1) {
      return state;
    }
    const newMessage = clone({
      ...state.messages[index],
      ...message,
    } as Message);
    return {
      messages: [
        ...state.messages.slice(0, index),
        newMessage,
        ...state.messages.slice(index + 1),
      ],
    };
  });
}

// 🔥 关键修改：sendMessage 函数接收 sessionId 参数
// 🔥 关键修改：sendMessage 函数正确处理 sessionId
export async function sendMessage(
  message: Message,
  params: {
    deepThinkingMode: boolean;
    searchBeforePlanning: boolean;
    sessionId: string; // 🔥 sessionId 参数
  },
  options: { abortSignal?: AbortSignal } = {},
) {
  console.log('🔥 sendMessage called with sessionId:', params.sessionId);

  // 🔥 验证 sessionId
  if (!params.sessionId) {
    console.error('❌ sessionId is required for sendMessage');
    throw new Error('sessionId is required');
  }

  addMessage(message);

  let stream: AsyncIterable<ChatEvent>;
  if (window.location.search.includes("mock")) {
    stream = mockChatStream(message);
  } else {
    // 🔥 关键：将 sessionId 作为 conversationId 传递给 chatStream
    stream = chatStream(
      message,
      useStore.getState().state,
      {
        deepThinkingMode: params.deepThinkingMode,
        searchBeforePlanning: params.searchBeforePlanning,
        conversationId: params.sessionId, // 🔥 传递会话ID
      },
      options
    );
  }

  setResponding(true);

  let textMessage: TextMessage | null = null;
  try {
    for await (const event of stream) {
      switch (event.type) {
        case "start_of_agent":
          textMessage = {
            id: event.data.agent_id,
            role: "assistant",
            type: "text",
            content: "",
          };
          addMessage(textMessage);
          break;
        case "message":
          if (textMessage) {
            textMessage.content += event.data.delta.content;
            updateMessage({
              id: textMessage.id,
              content: textMessage.content,
            });
          }
          break;
        case "end_of_agent":
          textMessage = null;
          break;
        case "start_of_workflow":
          const workflowEngine = new WorkflowEngine();
          const workflow = workflowEngine.start(event);
          const workflowMessage: WorkflowMessage = {
            id: event.data.workflow_id,
            role: "assistant",
            type: "workflow",
            content: { workflow: workflow },
          };
          addMessage(workflowMessage);
          for await (const updatedWorkflow of workflowEngine.run(stream)) {
            updateMessage({
              id: workflowMessage.id,
              content: { workflow: updatedWorkflow },
            });
          }
          _setState({
            messages: workflow.finalState?.messages ?? [],
          });
          break;
        default:
          break;
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return;
    }
    throw e;
  } finally {
    setResponding(false);
  }
  return message;
}

export function clearMessages() {
  useStore.setState({ messages: [] });
}

export function setResponding(responding: boolean) {
  useStore.setState({ responding });
}

export function _setState(state: {
  messages: { role: string; content: string }[];
}) {
  useStore.setState({ state });
}
