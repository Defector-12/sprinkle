export type PageStatus =
  | 'unactivated'
  | 'parsing'
  | 'ready'
  | 'partial'
  | 'failed'
  | 'answering';

export type ArticleBlockType =
  | 'heading'
  | 'paragraph'
  | 'code'
  | 'list'
  | 'quote';

export interface ArticleBlock {
  id: string;
  type: ArticleBlockType;
  text: string;
  section: string;
  order: number;
}

export interface ArticleImage {
  id: string;
  src: string;
  alt: string;
  caption: string;
  section: string;
  surroundingText: string;
}

export interface ArticleDocument {
  title: string;
  url: string;
  blocks: ArticleBlock[];
  images: ArticleImage[];
  isPartial: boolean;
}

export interface ArticleChunk {
  id: string;
  section: string;
  text: string;
  blockIds: string[];
}

export interface TextFocus {
  type: 'text';
  text: string;
  section: string;
}

export interface ImageFocus {
  type: 'image';
  imageUrl: string;
  alt: string;
  text: string;
  section: string;
  source: 'original' | 'screenshot';
}

export interface RegionFocus {
  type: 'region';
  imageUrl: string;
  text: string;
  section: string;
  source: 'screenshot';
}

export type FocusContext = TextFocus | ImageFocus | RegionFocus;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  error?: boolean;
}

export interface PageContext {
  key: string;
  tabId: number;
  url: string;
  normalizedUrl: string;
  title: string;
  status: PageStatus;
  article: ArticleDocument | null;
  focus: FocusContext | null;
  messages: ChatMessage[];
  warning: string | null;
  updatedAt: number;
}

export interface UserSettings {
  apiKey: string;
  retainConversations: boolean;
}

export interface ModelTextPart {
  type: 'text';
  text: string;
}

export interface ModelImagePart {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export type ModelContentPart = ModelTextPart | ModelImagePart;

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ModelContentPart[];
}

export interface ModelRequest {
  messages: ModelMessage[];
}
