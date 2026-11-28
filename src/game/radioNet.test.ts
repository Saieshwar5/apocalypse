import { describe, expect, it } from 'vitest';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { describeDirection, dockingExchange } from '../logic/radioScript';
import { RadioNet, lineSeconds } from './radioNet';

function radio() {
  const said: string[] = [];
  const hud = { showRadio: (line: { name: string; text: string }) => said.push(`${line.name}: ${line.text}`) } as unknown as Hud;
  const sound = { radioLine: () => undefined } as unknown as SoundEffects;
  const net = new RadioNet({ hud, sound, callSign: () => 'VEGA', random: () => 0 });
  const run = (seconds: number) => {
    for (let time = 0; time < seconds; time += 0.1) {
      net.update(0.1);
    }
  };
  return { net, said, run };
}

describe('the radio', () => {
  it('keeps an exchange together, the ship answering in its own call sign', () => {
    const { net, said, run } = radio();
    net.exchange(dockingExchange(0));
    run(12);
    expect(said).toEqual(['VEGA: Aegis, VEGA, on approach. Requesting docking.', 'CAPCOM REYES: VEGA, Aegis. Guides have you. Welcome home.']);
    expect(net.log.map((entry) => entry.channel)).toEqual(['YOU', 'EDA OPS']);
  });

  it('waits for one line to finish before the next, and lets an emergency cut in', () => {
    const { net, said, run } = radio();
    net.say('kestrel', 'Kestrel here. Lovely day for it.');
    net.say('moth', 'Moth. Agreed.');
    run(0.2);
    expect(said).toHaveLength(1);
    net.say('control', 'All pilots, impact imminent on Lagos!', true);
    run(0.2);
    expect(said[1]).toContain('impact imminent');
    run(15);
    expect(said.at(-1)).toContain('Moth. Agreed.');
  });

  it('only chatters into silence', () => {
    const { net, said, run } = radio();
    net.say('control', 'Field inbound, contracts are live.');
    run(0.2);
    net.chatter('moth', 'Moth. Nice weather.');
    run(15);
    expect(said.join(' ')).not.toContain('Nice weather');
    net.chatter('moth', 'Moth. Nice weather.');
    run(5);
    expect(said.at(-1)).toContain('Nice weather');
  });

  it('times lines by their length and describes directions in plain words', () => {
    expect(lineSeconds('Copy.')).toBeCloseTo(2.4);
    expect(lineSeconds('one two three four five six seven eight nine ten eleven twelve')).toBeGreaterThan(4);
    expect(describeDirection([0, 0, -10])).toBe('ahead');
    expect(describeDirection([0, -6, 10])).toBe('behind you, below');
    expect(describeDirection([10, 4, 0])).toBe('off to your right, above');
  });
});
