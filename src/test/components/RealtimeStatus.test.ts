import { describe, expect, it } from 'vitest';
import { dataChannelsStatus } from '../../../components/RealtimeStatus';

const topics = [
  'realtime:public:groups',
  'realtime:public:transactions',
  'realtime:public:payment_sources',
  'realtime:public:people',
  'realtime:public:group_members',
];

function channels(state: string) {
  return topics.map((topic) => ({ topic, state }));
}

describe('dataChannelsStatus', () => {
  it('shows Syncing while channels are joining', () => {
    expect(dataChannelsStatus(channels('joining'), false).status).toBe('connecting');
  });

  it('shows Live only when every data channel has joined', () => {
    expect(dataChannelsStatus(channels('joined'), true).status).toBe('connected');
  });

  it('shows Offline when a joined set later errors', () => {
    const next = channels('joined');
    next[1] = { topic: topics[1], state: 'errored' };
    expect(dataChannelsStatus(next, true).status).toBe('disconnected');
  });

  it('stays Syncing before any data channel exists', () => {
    expect(dataChannelsStatus([], false).status).toBe('connecting');
  });

  it('shows Offline if channels disappear after they were seen', () => {
    expect(dataChannelsStatus([], true).status).toBe('disconnected');
  });
});
