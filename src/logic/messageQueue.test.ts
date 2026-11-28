import { describe, expect, it } from 'vitest';
import { MessageQueue } from './messageQueue';

describe('message queue', () => {
  it('lets a danger interrupt and news wait behind it', () => {
    const queue = new MessageQueue();
    expect(queue.push({ text: 'Contract paid', tone: 'success', seconds: 3 })?.text).toBe('Contract paid');
    expect(queue.push({ text: 'Too low', tone: 'danger', seconds: 3 })?.text).toBe('Too low');
    // Lower-priority news waits while the danger is up.
    expect(queue.push({ text: 'Field cleared', tone: 'success', seconds: 3 })).toBeNull();
    expect(queue.waitingCount).toBe(2);
    let next = null;
    for (let step = 0; step < 40 && !next; step += 1) {
      const result = queue.update(0.1);
      next = typeof result === 'object' ? result : null;
    }
    expect(next?.text).toMatch(/Contract paid|Field cleared/);
  });

  it('extends a repeated message instead of flickering', () => {
    const queue = new MessageQueue();
    queue.push({ text: 'Iron resists lasers', tone: 'warning', seconds: 2 });
    expect(queue.push({ text: 'Iron resists lasers', tone: 'warning', seconds: 2 })).toBeNull();
    expect(queue.waitingCount).toBe(0);
  });

  it('replaces a same-level message once it has been read, and drops stale news', () => {
    const queue = new MessageQueue();
    queue.push({ text: 'A', tone: 'info', seconds: 5 });
    expect(queue.push({ text: 'B', tone: 'info', seconds: 5 })).toBeNull();
    queue.update(1.5);
    expect(queue.push({ text: 'C', tone: 'info', seconds: 5 })?.text).toBe('C');
    queue.update(7);
    expect(queue.waitingCount).toBe(0);
  });

  it('clears the line when nothing is left', () => {
    const queue = new MessageQueue();
    queue.push({ text: 'A', tone: 'info', seconds: 1 });
    expect(queue.update(1.1)).toBe('clear');
    expect(queue.current).toBeNull();
  });
});
