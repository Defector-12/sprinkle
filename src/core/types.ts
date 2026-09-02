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
  level?: number;
}

export interface ArticleImage {
  id: string;
  src: string;
  alt: string;
  caption: string;
  section: string;
  surroundingText: string;
  order?: number;
}

export interface ArticleTableCell {
  text: string;
  header: boolean;
  colSpan: number;
  rowSpan: number;
}

export interface ArticleTableRow {
  cells: ArticleTableCell[];
}

export interface ArticleTable {
  id: string;
  caption: string;
  section: string;
  order: number;
  rows: ArticleTableRow[];
}

export interface ArticleFormula {
  id: string;
  tex: string;
  mathml: string;
  section: string;
  order: number;
  display: 'inline' | 'block';
}

export type ArticleRootKind = 'article' | 'main' | 'role-main' | 'body';

export interface ArticleDiagnostics {
  rootKind: ArticleRootKind;
  readableLength: number;
  minimumReadableLength: number;
  rootTextLength: number;
  candidateBlockCount: number;
  acceptedBlockCount: number;
  excludedBlockCount: number;
  emptyBlockCount: number;
  articleCandidateCount: number;
  mainCandidateCount: number;
  roleMainCandidateCount: number;
  iframeCount: number;
  canvasCount: number;
  tableCount: number;
  shadowRootCount: number;
  loadingIndicatorCount: number;
  fallbackUsed: boolean;
  fallbackBlockCount: number;
}

export interface ArticleDocument {
  title: string;
  url: string;
  blocks: ArticleBlock[];
  images: ArticleImage[];
  tables?: ArticleTable[];
  formulas?: ArticleFormula[];
  isPartial: boolean;
  diagnostics?: ArticleDiagnostics;
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
  scope?: 'section';
  headingLevel?: number;
}

export interface ImageFocus {
  type: 'image';
  imageUrl: string;
  alt: string;
  text: string;
  section: string;
  source: 'original' | 'screenshot' | 'upload';
}

export interface RegionFocus {
  type: 'region';
  imageUrl: string;
  text: string;
  section: string;
  source: 'screenshot';
}

export type FocusContext = TextFocus | ImageFocus | RegionFocus;

export type MessageReference =
  | TextFocus
  | (Omit<ImageFocus, 'imageUrl'> & { imageUrl?: string })
  | (Omit<RegionFocus, 'imageUrl'> & { imageUrl?: string });

export type AnswerModel = 'deepseek' | 'doubao'; // Doubao remains for archived conversations.

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  reference?: MessageReference;
  answeredBy?: AnswerModel;
  error?: boolean;
}

export interface ArchivedConversation {
  schemaVersion: 2;
  normalizedUrl: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ConversationSummary {
  normalizedUrl: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  questionCount: number;
  lastQuestion: string;
}

export interface ConversationArchiveUsage {
  bytesInUse: number;
  quotaBytes: number;
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
  warningDetail?: string | null;
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
