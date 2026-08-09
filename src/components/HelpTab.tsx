export function HelpTab() {
  return (
    <div className="flex-1 overflow-y-auto no-scrollbar pb-10 pt-12 max-w-4xl">
      <div className="mb-8">
        <h2 className="text-[28px] font-bold text-white mb-2 tracking-tight">Help</h2>
        <p className="text-gray-400 text-sm max-w-2xl">
          DailyEz uses AI-powered signals to surface high-priority messages from your connected platforms. Use the sidebar to navigate, add signals to capture important content, and review messages requiring action.
        </p>
      </div>

      <div className="space-y-8">
        <section className="bg-[#111] border border-[#222] rounded-3xl p-8">
          <h3 className="text-xl font-semibold text-white mb-3">Getting Started</h3>
          <ul className="space-y-3 text-gray-300 text-sm list-disc list-inside">
            <li>Connect your platforms in Settings to start pulling messages into DailyEz.</li>
            <li>Use the <strong>All Inbox</strong> view to browse raw messages across connected sources.</li>
            <li>Open <strong>Matched</strong> to see content that matches your watchlist signals.</li>
            <li>Use <strong>Priority</strong> to review only messages that require action or an LLM recommendation.</li>
          </ul>
        </section>

        <section className="bg-[#111] border border-[#222] rounded-3xl p-8">
          <h3 className="text-xl font-semibold text-white mb-3">Adding Signals</h3>
          <div className="space-y-3 text-gray-300 text-sm">
            <p>Signals help DailyEz identify the messages you care about. Add a new signal in the watchlist panel and give it a clear keyword or phrase.</p>
            <p>When a message contains the defined context, DailyEz marks it as matched and surfaces it in the Matched view.</p>
            <p>Signals can be edited or removed from the watchlist panel at any time.</p>
          </div>
        </section>

        <section className="bg-[#111] border border-[#222] rounded-3xl p-8">
          <h3 className="text-xl font-semibold text-white mb-3">Priority Messages</h3>
          <div className="space-y-3 text-gray-300 text-sm">
            <p>The <strong>Priority</strong> tab shows only messages that require action or contain an LLM-generated call to action.</p>
            <p>These messages are selected from your inbox and matched content, so you can focus on what needs a response or decision.</p>
            <p>Use the platform filters at the top of Priority to limit the feed to Gmail, WhatsApp, or Discord.</p>
          </div>
        </section>

        <section className="bg-[#111] border border-[#222] rounded-3xl p-8">
          <h3 className="text-xl font-semibold text-white mb-3">FAQ</h3>
          <div className="space-y-4 text-gray-300 text-sm">
            <div>
              <p className="font-semibold text-white">How do I edit my profile?</p>
              <p>Click your profile avatar in the top-right corner, then update your name, email, or avatar image in the profile editor.</p>
            </div>
            <div>
              <p className="font-semibold text-white">How do I add a new signal?</p>
              <p>Use the watchlist panel on the right side of the dashboard. Add a signal with the keyword or phrase you want to monitor.</p>
            </div>
            <div>
              <p className="font-semibold text-white">Why don’t I see messages yet?</p>
              <p>Make sure your platform connections are active in Settings and that signals are defined. Then refresh or wait a few moments for the system to fetch and match messages.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
