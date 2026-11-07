import { useState } from 'react';
import { api, getApiError } from '../api/client.js';
import { formatPaise } from '../lib/money.js';

const examples = [
  'What is the total outstanding balance?',
  'How much is overdue?',
  'Show outstanding fees by centre',
  'Show outstanding fees by batch',
  'How much has been collected?',
  'What is Ishita Sharma’s balance?'
];

export default function FeeAssistantPage() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function ask(event) {
    event.preventDefault();
    setError('');
    setAnswer(null);
    setLoading(true);
    try {
      const { data } = await api.post('/assistant/ask', { question });
      setAnswer(data);
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setLoading(false);
    }
  }

  function chooseExample(example) {
    setQuestion(example);
    setAnswer(null);
    setError('');
  }

  return (
    <section className="assistant-page">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">ACCOUNTS WORKSPACE</p>
          <h1>Fee assistant</h1>
          <p>Ask a question about the live fee ledger.</p>
        </div>
      </div>
      <section className="panel assistant-panel">
        <div className="assistant-intro">
          <span className="assistant-icon" aria-hidden="true">✦</span>
          <div>
            <h2>Ledger questions, answered privately</h2>
            <p>Answers are calculated from the current records. No student information is sent to an AI provider.</p>
          </div>
        </div>
        <form className="assistant-form" onSubmit={ask}>
          <label htmlFor="assistant-question">Your question</label>
          <div className="assistant-input-row">
            <input
              id="assistant-question"
              maxLength={240}
              minLength={2}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="e.g. What is overdue by centre?"
              required
              value={question}
            />
            <button className="button-primary" disabled={loading || question.trim().length < 2} type="submit">
              {loading ? 'Checking…' : 'Ask'}
            </button>
          </div>
        </form>
        <div className="assistant-examples" aria-label="Example questions">
          <p>Try asking</p>
          <div>{examples.map((example) => (
            <button key={example} onClick={() => chooseExample(example)} type="button">{example}</button>
          ))}</div>
        </div>
        {error && <div className="notice-error assistant-notice" role="alert">{error}</div>}
        {answer && (
          <section aria-live="polite" className="assistant-answer">
            <p className="page-eyebrow">LEDGER ANSWER</p>
            <h2>{answer.answer}</h2>
            {answer.results.length ? (
              <div className="assistant-results">
                {answer.results.map((item) => (
                  <div className="assistant-result" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.label === 'Collection rate' ? `${item.value}%` : formatPaise(item.amountPaise)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="assistant-empty">{answer.type === 'unsupported'
                ? 'No ledger data was queried. Try one of the example questions above.'
                : 'No fee plan is assigned to this student.'}</p>
            )}
            <p className="assistant-footnote">Source: active student fee plans and completed payment records.</p>
          </section>
        )}
      </section>
    </section>
  );
}
