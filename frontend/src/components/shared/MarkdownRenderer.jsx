import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// Lazy-load mermaid to reduce bundle size and build memory usage
let mermaidPromise = null;
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        flowchart: {
          htmlLabels: true,
          useMaxWidth: true,
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

// Pre-process mermaid code to fix common issues
export function preprocessMermaidCode(code) {
  if (!code) return code;

  // Remove leading/trailing whitespace and normalize line endings
  code = code.trim().replace(/\r\n/g, '\n');

  // Remove empty lines at the start (after diagram type declaration)
  code = code.replace(/^(\w[\w-]*(?:\s+\w+)*)\n\n+/m, '$1\n');

  // Fix subgraph names with special characters — quote them
  code = code.replace(/^(\s*subgraph\s+)([^"'\[\n]+?)(\s*)$/gm, (match, prefix, name, suffix) => {
    const trimmedName = name.trim();
    if (/^\w+$/.test(trimmedName)) return match;
    if ((trimmedName.startsWith('"') && trimmedName.endsWith('"')) ||
        (trimmedName.startsWith("'") && trimmedName.endsWith("'"))) return match;
    return `${prefix}"${trimmedName}"${suffix}`;
  });

  // Fix node labels in square brackets — quote labels with spaces or non-ASCII
  code = code.replace(/^(\s*)(\w+)\[([^\]"]+)\]/gm, (match, indent, nodeId, label) => {
    if (/\s/.test(label) || /[^\x00-\x7F]/.test(label) || /[(){}#&;]/.test(label)) {
      return `${indent}${nodeId}["${label.replace(/"/g, '#quot;')}"]`;
    }
    return match;
  });

  // Fix node labels in round brackets (stadium shape)
  code = code.replace(/^(\s*)(\w+)\(([^()"]+)\)(?!\()/gm, (match, indent, nodeId, label) => {
    if (/\s/.test(label) || /[^\x00-\x7F]/.test(label)) {
      return `${indent}${nodeId}("${label.replace(/"/g, '#quot;')}")`;
    }
    return match;
  });

  // Fix node labels in double round brackets (circle shape)
  code = code.replace(/^(\s*)(\w+)\(\(([^)"]+)\)\)/gm, (match, indent, nodeId, label) => {
    if (/\s/.test(label) || /[^\x00-\x7F]/.test(label)) {
      return `${indent}${nodeId}(("${label.replace(/"/g, '#quot;')}"))`;
    }
    return match;
  });

  // Fix node labels in curly braces (rhombus/diamond shape)
  code = code.replace(/^(\s*)(\w+)\{([^}"]+)\}/gm, (match, indent, nodeId, label) => {
    if (/\s/.test(label) || /[^\x00-\x7F]/.test(label)) {
      return `${indent}${nodeId}{"${label.replace(/"/g, '#quot;')}"}`;
    }
    return match;
  });

  // Fix edge labels — quote labels with spaces or non-ASCII
  code = code.replace(/\|([^|"]+)\|/g, (match, label) => {
    if (/\s/.test(label) || /[^\x00-\x7F]/.test(label)) {
      return `|"${label}"|`;
    }
    return match;
  });

  // Fix arrow syntax: normalize various arrow styles
  // e.g., "-- >" to "-->" , "- ->" to "-->"
  code = code.replace(/--\s*>/g, '-->');
  code = code.replace(/-\s->/g, '-->');
  code = code.replace(/==\s*>/g, '==>');

  // Remove trailing semicolons on lines (common LLM mistake)
  code = code.replace(/;\s*$/gm, '');

  // Fix common "end;" to "end"
  code = code.replace(/^(\s*end)\s*;/gm, '$1');

  return code;
}

// Mermaid diagram component
export function MermaidDiagram({ code }) {
  const containerRef = useRef(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const renderDiagram = async () => {
      if (!code) return;
      setLoading(true);
      const mermaid = await getMermaid();
      const processedCode = preprocessMermaidCode(code);

      // Try rendering, and on failure try with the original code too
      const attempts = [processedCode, code];
      for (let i = 0; i < attempts.length; i++) {
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        try {
          const tempContainer = document.createElement('div');
          tempContainer.style.display = 'none';
          document.body.appendChild(tempContainer);
          const { svg } = await mermaid.render(id, attempts[i], tempContainer);
          tempContainer.remove();
          setSvg(svg);
          setError(null);
          setLoading(false);
          return;
        } catch (err) {
          document.querySelectorAll(`#d${id}, [id^="dmermaid-"]`).forEach(el => el.remove());
          if (i === attempts.length - 1) {
            console.error('Mermaid render error:', err);
            setError(err.message);
          }
        }
      }
      setLoading(false);
    };
    renderDiagram();
  }, [code]);

  if (loading && !svg && !error) {
    return <div className="mermaid-loading">Loading diagram...</div>;
  }

  if (error) {
    return (
      <div className="mermaid-fallback">
        <details>
          <summary>Diagram (click to view source)</summary>
          <pre className="code-block language-mermaid"><code>{code}</code></pre>
        </details>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// Parse YAML frontmatter from markdown content
export function parseFrontmatter(content) {
  if (!content) return { metadata: null, content: '' };

  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = content.match(frontmatterRegex);

  if (!match) return { metadata: null, content };

  const frontmatter = match[1];
  const markdownContent = content.slice(match[0].length);

  const metadata = {};
  frontmatter.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      metadata[key] = value;
    }
  });

  return { metadata, content: markdownContent };
}

// Clean notes content
export function cleanNotesContent(content) {
  if (!content) return content;

  content = content.replace(/^>\s*(阅读状态|论文链接|代码链接|最后更新).*$/gm, '');
  content = content.replace(/<details>\s*<summary>原始输出<\/summary>[\s\S]*?<\/details>/g, '');
  content = content.replace(/##\s*原始输出[\s\S]*?(?=\n##|\n---|\Z)/g, '');
  content = content.replace(/\n{4,}/g, '\n\n\n');

  return content;
}

// Shared markdown components for ReactMarkdown
export const markdownComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';

    if (language === 'mermaid' && !inline) {
      return <MermaidDiagram code={String(children).replace(/\n$/, '')} />;
    }

    if (!inline && language) {
      return (
        <pre className={`code-block language-${language}`}>
          <code {...props}>{children}</code>
        </pre>
      );
    }

    return <code className="inline-code" {...props}>{children}</code>;
  },
};

// Reusable MarkdownContent component
export default function MarkdownContent({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
}
