/**
 * 文本处理模块
 * 提供标点修正、剪贴板操作、文件导出功能
 */
export class TextProcessor {
  /** 基础标点修正规则 */
  static punctuationRules = [
    { pattern: /，/g, replacement: '，' },
    { pattern: /。/g, replacement: '。' },
    { pattern: /？/g, replacement: '？' },
    { pattern: /！/g, replacement: '！' },
    { pattern: /；/g, replacement: '；' },
    { pattern: /：/g, replacement: '：' },
    { pattern: /""/g, replacement: '"' },
    { pattern: /、/g, replacement: '、' },
    { pattern: /\?/g, replacement: '？' },
    { pattern: /!/g, replacement: '！' },
    { pattern: /,/g, replacement: '，' },
    { pattern: /\.\s/g, replacement: '。' },
    { pattern: /\.$/g, replacement: '。' },
    { pattern: /\s+/g, replacement: '' },
  ];

  /**
   * 英文标点修正规则
   */
  static englishRules = [
    { pattern: /\bi\b(?=[\s.,!?']|$)/g, replacement: 'I' },
    { pattern: /(?:^|[.!?]\s+)([a-z])/g, replacement: (_, c) => _.replace(c, c.toUpperCase()) },
  ];

  /**
   * 修正标点（中文）
   */
  static fixChinesePunctuation(text) {
    let result = text;
    result = result.replace(/，/g, '，');
    result = result.replace(/。/g, '。');
    result = result.replace(/\?/g, '？');
    result = result.replace(/!/g, '！');
    result = result.replace(/，/g, '，');
    result = result.replace(/\s*(。|，|？|！|；|：)\s*/g, '$1');
    // 移除句间多余空格
    result = result.replace(/([^\x00-\xff])\s+([^\x00-\xff])/g, '$1$2');
    // 句首大写 → 保持中文习惯不变
    return result;
  }

  /**
   * 修正标点（英文）
   */
  static fixEnglishPunctuation(text) {
    let result = text;
    // 句首大写
    result = result.replace(/(?:^|[.!?]\s+)([a-z])/g, (match) => match.toUpperCase());
    // 单字母 I 大写
    result = result.replace(/\bi\b(?=[\s.,!?']|$)/g, 'I');
    // 逗号句号后加空格
    result = result.replace(/([.,!?;:])([^\s\d])/g, '$1 $2');
    return result;
  }

  /**
   * 自动选择修正方法
   */
  static fixPunctuation(text, lang = 'zh-CN') {
    if (!text) return text;
    if (lang.startsWith('en')) {
      return TextProcessor.fixEnglishPunctuation(text);
    }
    return TextProcessor.fixChinesePunctuation(text);
  }

  /**
   * 复制文本到剪贴板
   */
  static async copyToClipboard(text) {
    if (!text) return { success: false, error: '没有可复制的文本' };
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return { success: true };
      }
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || '复制失败' };
    }
  }

  /**
   * 导出为TXT文件
   */
  static exportToTxt(text, filename = 'transcript') {
    if (!text) return { success: false, error: '没有可导出的文本' };
    const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { success: true };
  }
}
