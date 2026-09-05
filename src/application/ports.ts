import type {
  ArchivedConversation,
  ConversationArchiveUsage,
  ConversationSummary,
  ImageFocus,
  PageContext,
  RegionFocus,
  TextFocus,
  UserSettings,
} from '../core/types.ts';

export interface StudyCaptureRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FloatingAssistantBridge {
  initialize(): Promise<PageContext>;
  activate(): Promise<PageContext>;
  deactivate(): Promise<PageContext>;
  hasApiKey(): Promise<boolean>;
  ask(question: string): Promise<PageContext>;
  startImagePicker(): Promise<void>;
  startRegionPicker(): Promise<void>;
  setImageFocus(focus: ImageFocus): Promise<PageContext>;
  clearFocus(): Promise<PageContext>;
  openStudy(): Promise<void>;
  openHistory(): Promise<void>;
  openSettings(): Promise<void>;
  subscribe(listener: (context: PageContext) => void): () => void;
}

export interface StudyWorkspaceBridgeContract {
  initialize(): Promise<PageContext>;
  ask(question: string): Promise<PageContext>;
  translate(text: string, section: string): Promise<string>;
  setTextFocus(
    text: string,
    section: string,
    scope?: TextFocus['scope'],
    headingLevel?: number,
  ): Promise<PageContext>;
  setImageFocus(focus: ImageFocus): Promise<PageContext>;
  setRegionFocus(focus: RegionFocus): Promise<PageContext>;
  captureRegion(rect: StudyCaptureRect): Promise<string>;
  clearFocus(): Promise<PageContext>;
  openSource(): Promise<void>;
  openHistory(): Promise<void>;
  subscribe(listener: (context: PageContext) => void): () => void;
}

export interface SettingsStore {
  load(): Promise<UserSettings>;
  save(settings: UserSettings): Promise<void>;
  clearConversations(): Promise<void>;
}

export interface HistoryLibraryBridgeContract {
  list(query?: string): Promise<ConversationSummary[]>;
  get(url: string): Promise<ArchivedConversation | null>;
  delete(url: string): Promise<void>;
  clear(): Promise<void>;
  usage(): Promise<ConversationArchiveUsage>;
  continue(url: string): Promise<void>;
  openSettings(): Promise<void>;
  subscribe(listener: () => void): () => void;
}
