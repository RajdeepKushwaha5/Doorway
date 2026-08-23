import Link from 'next/link';
import { ProofWalkthrough } from '@/components/ProofWalkthrough';
import {
  getConsoleCapabilitiesAction,
  getProofOpportunityAction,
  getProofScenariosAction,
} from '@/app/actions';
import { api } from '@/lib/api';
import type { CollectorSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

/*
 * Room to wake the backend.
 *
 * The API sleeps on its free plan and the first read is what wakes it. The
 * default budget is shorter than that takes, which turned a cold visit into a
 * page with nothing on it.
 */
export const maxDuration = 60;

/**
 * The front door for anyone who wants to check the claim rather than read it.
 *
 * Everything this project argues rests on one thing being true: a scraper can
 * return valid, plausible, wrong data indefinitely, and nothing in an ordinary
 * stack notices. That is a claim about absence, which is the hardest kind to
 * take on trust. So this page hands the visitor the fault switch.
 *
 * It lives at its own route, linked from the top of the site, because the
 * demonstration used to be reachable only by finding the engine dashboard and
 * knowing which of its panels to operate. A judge, or anybody else, should not
 * have to reverse-engineer a control surface to find out whether the thing
 * works.
 */

export default async function ProofPage() {
  const [{ mode, scenarios }, capabilities, served] = await Promise.all([
    getProofScenariosAction(),
    getConsoleCapabilitiesAction(),
    getProofOpportunityAction(),
  ]);

  const opportunity = served.state === 'ok' ? served.opportunity : null;
  // Told apart, because "nothing is served" and "we could not ask" are
  // different facts and only one of them is about Doorway.
  const unreachable = served.state === 'unreachable' ? served.detail : null;

  let collectors: CollectorSummary[] = [];
  let offline = false;
  try {
    collectors = await api.listCollectors();
  } catch {
    offline = true;
  }

  /*
   * Run the collector behind the record shown in step 1.
   *
   * Choosing by fixture hostname looked equivalent and was not. When the
   * source page sits behind a tunnel its host is not the fixture's, so the
   * match failed, the page fell back to whichever collector happened to be
   * registered first, and the run button offered to observe an unrelated one.
   * The record on screen names its own collector, so ask it.
   */
  const collector =
    opportunity === null
      ? null
      : (collectors.find((entry) => entry.id === opportunity.collectorId) ?? null);
  // As on the control room: watchUrls can be absent on a collector that came
  // from a backend deployed at an earlier version.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const watchUrl = collector?.watchUrls?.[0] ?? null;

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-[1100px] px-6 py-16 lg:px-10">
        <nav className="font-mono text-[12px]">
          <Link href="/" className="text-gray-500 underline underline-offset-4 hover:text-black">
            The world
          </Link>
        </nav>

        <header className="mt-6 border-b border-black pb-8">
          <div className="font-neuebit text-[11px] uppercase tracking-[0.18em] text-emerald-600 font-bold">
            Check it yourself
          </div>
          <h1 className="mt-3 max-w-[900px] font-mondwest text-[clamp(34px,5vw,60px)] leading-[0.95] tracking-[-0.02em]">
            Break the page. Watch what we do about it.
          </h1>
          <p className="mt-5 max-w-[780px] font-mono text-[13px] leading-relaxed text-gray-600">
            A scraper that breaks loudly is an easy problem. The one that matters returns a number
            that is the right shape, the right currency and the wrong fact, and keeps doing it for
            months. Nothing errors. Nothing alerts. Below you can cause exactly that on a controlled
            page and see whether this system catches it, using the same two Bright Data sensors that
            run in production.
          </p>
          <p className="mt-4 max-w-[780px] font-mono text-[12.5px] leading-relaxed text-gray-500">
            Each fault states the verdict a correct system should reach before you run it, so the
            demonstration can fail in front of you. No step here needs a terminal.
          </p>
        </header>

        {offline ? (
          <p className="mt-10 border border-neutral-300 bg-neutral-50 p-5 font-mono text-[13px] leading-relaxed text-neutral-800">
            The Doorway API could not be reached, so this page cannot show what is currently served
            or run anything against it. It shows nothing rather than a cached guess. Start the
            backend and reload.
          </p>
        ) : null}

        <ProofWalkthrough
          collectorId={collector?.id ?? null}
          watchUrl={watchUrl}
          unreachable={unreachable}
          initialMode={mode}
          scenarios={scenarios}
          opportunity={opportunity}
          canRun={capabilities.canRunCollector}
          canSwitch={capabilities.canSwitchFixture}
        />

        <section className="mt-12 border border-black p-6">
          <h2 className="font-mondwest text-2xl leading-tight">
            This page is a controlled fixture, and says so
          </h2>
          <p className="mt-3 max-w-[800px] font-mono text-[12.5px] leading-relaxed text-gray-600">
            The fellowship above is not real, and the foundation offering it does not exist. Faults
            have to happen on cue to be demonstrable, and no real funding body will corrupt its own
            deadline on a schedule for us. Everything else in the loop is real: a real Scraper
            Studio collector, a real Web Unlocker read of the same page, and the same reconciliation
            that runs against real sources. Doorway never presents a fabricated opportunity as a
            genuine one, which is why every fixture record carries its provider label.
          </p>
        </section>
      </div>
    </div>
  );
}
