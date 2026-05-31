import React from 'react';

function normalizeNeedle(value) {
  return String(value || '').trim().toLowerCase();
}

export function textMatchesQuery(value, query) {
  const needle = normalizeNeedle(query);
  if (!needle) return true;
  return String(value || '').toLowerCase().includes(needle);
}

export function tokenizeHighlightedText(value, query) {
  const text = String(value ?? '');
  const needle = normalizeNeedle(query);
  if (!needle) return [{ text, highlighted: false }];

  const lowerText = text.toLowerCase();
  const tokens = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(needle);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      tokens.push({ text: text.slice(cursor, matchIndex), highlighted: false });
    }
    tokens.push({
      text: text.slice(matchIndex, matchIndex + needle.length),
      highlighted: true,
    });
    cursor = matchIndex + needle.length;
    matchIndex = lowerText.indexOf(needle, cursor);
  }

  if (cursor < text.length) {
    tokens.push({ text: text.slice(cursor), highlighted: false });
  }

  return tokens.length > 0 ? tokens : [{ text, highlighted: false }];
}

export function HighlightedText({ text, query, markClassName = 'text-highlight' }) {
  return tokenizeHighlightedText(text, query).map((token, index) => (
    token.highlighted ? (
      <mark className={markClassName} key={`${token.text}-${index}`}>
        {token.text}
      </mark>
    ) : (
      <React.Fragment key={`${token.text}-${index}`}>{token.text}</React.Fragment>
    )
  ));
}
