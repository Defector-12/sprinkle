import type {
  ArticleChunk,
  ArticleDocument,
  ChatMessage,
  FocusContext,
  ModelContentPart,
  ModelMessage,
  ModelRequest,
} from './types.ts';

export interface BuildModelRequestInput {
  article: ArticleDocument;
  question: string;
  relevantChunks: ArticleChunk[];
  history: ChatMessage[];
  focus: FocusContext | null;
}

function articleContext(
  article: ArticleDocument,
  chunks: ArticleChunk[],
): string {
  const selectedChunks =
    chunks.length > 0
      ? chunks
      : [
          {
            id: 'article-fallback',
            section: article.title,
            text: article.blocks
              .slice(0, 8)
              .map((block) => block.text)
              .join('\n'),
            blockIds: [],
          },
        ];

  return selectedChunks
    .map((chunk) => `[${chunk.section}]\n${chunk.text}`)
    .join('\n\n');
}

function focusDescription(focus: FocusContext | null): string {
  if (!focus) return '';
  if (focus.type === 'text') {
    return `\n\n用户当前选中的内容：\n${focus.text}\n所属章节：${focus.section}`;
  }

  const imageDescription =
    focus.type === 'image' ? focus.alt || focus.text : focus.text;
  return `\n\n用户当前关注的图片或区域：${imageDescription}\n所属章节：${focus.section}`;
}

function currentUserContent(
  question: string,
  focus: FocusContext | null,
): string | ModelContentPart[] {
  const text = `${question}${focusDescription(focus)}`;
  if (!focus || focus.type === 'text') return text;

  return [
    { type: 'text', text },
    {
      type: 'image_url',
      image_url: {
        url: focus.imageUrl,
      },
    },
  ];
}

export function buildModelRequest(
  input: BuildModelRequestInput,
): ModelRequest {
  const completenessNote = input.article.isPartial
    ? '当前页面内容可能不完整，回答时必须明确这一限制。'
    : '当前页面内容已完成解析。';
  const systemMessage = [
    '你是一个技术文章阅读助手。',
    '优先依据当前文章语境回答，再使用通用知识补足文章没有解释的概念。',
    '不要提供原文出处、段落编号、引用卡片或跳转位置。',
    '如果文章没有足够信息，请直接说明，不要把推测写成文章结论。',
    completenessNote,
    `文章标题：${input.article.title}`,
    `文章地址：${input.article.url}`,
    '与问题相关的文章内容：',
    articleContext(input.article, input.relevantChunks),
  ].join('\n');

  const history: ModelMessage[] = input.history.slice(-8).map((message) => ({
    role: message.role,
    content: message.content,
  }));

  return {
    messages: [
      {
        role: 'system',
        content: systemMessage,
      },
      ...history,
      {
        role: 'user',
        content: currentUserContent(input.question, input.focus),
      },
    ],
  };
}
