import { Logo } from '../components/Logo';
import { playClick } from '../lib/sound';

interface Props {
  onBack: () => void;
  onSuggest: () => void;
}

/**
 * Play requires the privacy policy to be reachable from a stable public URL,
 * and the same URL goes in the store listing. Kept as constants so the two
 * links cannot drift apart from the pages themselves.
 */
const PRIVACY_URL = 'https://quietfoundry.io/continue/privacy';
const DELETE_URL = 'https://quietfoundry.io/continue/delete-my-data';

/**
 * Written in the app's own voice rather than as a product page. Anyone opening
 * this already installed the thing — they want to know who made it and why it
 * exists, not to be sold it a second time.
 */
export function AboutScreen({ onBack, onSuggest }: Props) {
  return (
    <div className="screen">
      <div className="counter-top">
        <button
          className="nav-btn"
          onClick={() => {
            playClick();
            onBack();
          }}
          aria-label="Back"
        >
          ←
        </button>
        <h3 className="scr-title" style={{ margin: 0 }}>
          About
        </h3>
      </div>

      <div className="about-hero">
        <Logo size={40} />
        <div>
          <div className="about-name">Continue?</div>
          <div className="tag">your tally. your bragging rights.</div>
        </div>
      </div>

      <div className="about-block">
        <h4>What it is</h4>
        <p>
          A death counter. You die, you tap the button, the number goes up. That's genuinely the
          whole thing.
        </p>
      </div>

      <div className="about-block">
        <h4>Why it exists</h4>
        <p>
          Streamers have had death counters sitting in the corner of the screen for years, and you
          always know exactly how rough a run is going just by glancing at it.
        </p>
        <p>
          I wanted that for the games I actually play. Not "that boss was brutal" from memory, but a
          real number — and a way to tell which games were genuinely hard for me, rather than the
          ones I just remember being hard.
        </p>
      </div>

      <div className="about-block">
        <h4>How it works out difficulty</h4>
        <p>
          Every death gets logged against a specific run, so NG, NG+ and NG++ each keep their own
          count instead of blurring into one pile.
        </p>
        <p>
          The play time tracker turns that raw count into <strong>deaths per hour</strong>, which is
          the only fair way to compare a sixty-hour game with a six-hour one. Two hundred deaths
          over a full playthrough is a very different story from two hundred in an afternoon.
        </p>
        <p>
          That feeds the difficulty ranking, which scores your games against each other. It's your
          ranking, from your deaths — not a review score, and not anyone else's opinion.
        </p>
      </div>

      <div className="about-block">
        <h4>Any game, really</h4>
        <p>
          Built with Souls-likes in mind, because that's where a death count is worn as a badge
          rather than hidden. But nothing here cares what you're playing. Platformers, roguelikes,
          racing games, that one puzzle game that keeps getting you — if it can kill you, it can be
          counted.
        </p>
      </div>

      <div className="about-block">
        <h4>Credits</h4>
        <p>
          Made by <strong>Quiet Foundry</strong>.
        </p>
        <p className="about-fine">
          Game names and cover art come from IGDB. Your tally lives on your phone; a backup is kept
          in the cloud only so you can get it back if you lose the device.
        </p>
      </div>

      <div className="about-block">
        <h4>Got an idea?</h4>
        <p>
          Tell me. It won't get a reply, but it does get read, and a fair bit of what's in here
          started as somebody being mildly irritated by something.
        </p>
        <button
          className="text-btn wide"
          style={{ marginTop: 8 }}
          onClick={() => {
            playClick();
            onSuggest();
          }}
        >
          Suggest something
        </button>
      </div>

      <div className="about-block">
        <h4>Your data</h4>
        <p>
          No ads, no analytics, no tracking. An email address is optional and only ever used to send
          you a sign-in code so you can get your tally back on a new phone.
        </p>
        {/* Opened in the system browser rather than the webview: an in-app
            browser showing a privacy policy looks like part of the app, and
            people should be able to see the real address it came from. */}
        <p className="about-links">
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
            Privacy policy
          </a>
          <span aria-hidden="true"> · </span>
          <a href={DELETE_URL} target="_blank" rel="noopener noreferrer">
            Delete your data
          </a>
        </p>
      </div>

      <p className="ghost-note" style={{ marginTop: 'auto' }}>
        Version {__APP_VERSION__}
      </p>
    </div>
  );
}
