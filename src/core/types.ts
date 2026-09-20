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

export interface ConversationCheckpoint {
  schemaVersion: 1;
  throughMessageId: string;
  coveredTurnCount: number;
  createdAt: number;
  updatedAt: number;
  goal: string;
  activeTopic: string;
  items: Array<{
    text: string;
    status: 'pending' | 'active' | 'completed';
  }>;
  decisions: string[];
  userConstraints: string[];
  unresolvedReferences: string[];
}

export type QuestionTraceStatus =
  | 'preparing'
  | 'requesting'
  | 'completed'
  | 'failed'
  | 'interrupted';

export interface QuestionTraceEvidence {
  id: string;
  section: string;
  text: string;
  characterCount: number;
  blockIds: string[];
  sources?: string[];
  reasons?: string[];
  score?: number;
}

export interface QuestionTraceRequestMessage {
  role: ModelMessage['role'];
  content: string;
}

export interface QuestionTraceRequest {
  model: string;
  messageCount: number;
  textCharacters: number;
  imageCount: number;
  messages: QuestionTraceRequestMessage[];
}

export interface QuestionTrace {
  schemaVersion: 1;
  pipelineVersion: string;
  extensionVersion: string;
  createdAt: number;
  updatedAt: number;
  status: QuestionTraceStatus;
  question: string;
  article: {
    rootKind: ArticleRootKind | 'unknown';
    readableCharacters: number;
    blockCount: number;
    chunkCount: number;
    isPartial: boolean;
  };
  focus: {
    type: FocusContext['type'] | 'none';
    section?: string;
    scope?: TextFocus['scope'];
    text?: string;
    selectedCharacters: number;
  };
  retrieval: {
    strategy:
      | 'full-context'
      | 'fused-retrieval'
      | 'whole-article'
      | 'section-reference'
      | 'focused-reference'
      | 'bm25';
    mode: 'relevant' | 'whole';
    isTruncated: boolean;
    initialEvidence: QuestionTraceEvidence[];
    finalEvidence: QuestionTraceEvidence[];
    budget?: {
      limit: number;
      fullArticleCharacters: number;
      articleCharacters: number;
      historyCharacters: number;
      checkpointCharacters?: number;
    };
  };
  planner: {
    outcome: 'pending' | 'skipped' | 'completed' | 'unavailable';
    reason: string;
    rewrittenQuestion?: string;
    queries?: string[];
    evidenceNeeds?: Array<{
      query: string;
      reason: string;
    }>;
    coverage?: 'focused' | 'multi-section' | 'document-wide';
    useConversation?: boolean;
    request?: QuestionTraceRequest;
    rawResponse?: string;
    error?: string;
  };
  memory?: {
    checkpointOutcome:
      | 'not-needed'
      | 'reused'
      | 'created'
      | 'unavailable';
    checkpointCharacters: number;
    throughMessageId?: string;
    recentTurnCount: number;
    recalledTurnCount: number;
    compactedTurnCount: number;
    error?: string;
  };
  request?: QuestionTraceRequest;
  response?: {
    outcome: 'completed' | 'failed' | 'interrupted';
    characterCount?: number;
    error?: string;
    finishedAt: number;
  };
}

export type AnswerModel = 'deepseek' | 'doubao'; // Doubao remains for archived conversations.

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  reference?: MessageReference;
  answeredBy?: AnswerModel;
  error?: boolean;
  trace?: QuestionTrace;
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
  conversationCheckpoint?: ConversationCheckpoint | null;
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
