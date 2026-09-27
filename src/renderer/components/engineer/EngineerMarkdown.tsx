import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function externalHref(href: string | undefined): string | undefined {
  if (!href) return undefined
  try {
    const url = new URL(href)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

export function EngineerMarkdown({ text }: { text: string }): React.ReactElement {
  return (
    <div className="engineer-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            const safeHref = externalHref(href)
            return safeHref
              ? <a href={safeHref} target="_blank" rel="noopener noreferrer">{children}</a>
              : <span>{children}</span>
          },
          img: () => null
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
