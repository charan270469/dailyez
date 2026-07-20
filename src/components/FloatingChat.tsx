import { useState } from 'react';
import { MessageSquare, X, Sparkles, ArrowUp, MoreHorizontal } from 'lucide-react';

export function FloatingChat() {
  const [isOpen, setIsOpen] = useState(false);

  if (isOpen) {
    return (
      <div className="fixed bottom-6 right-6 w-[380px] h-[550px] bg-[#1a1a1a] border border-[#2a2a2a] rounded-[12px] shadow-2xl flex flex-col z-50 overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-start px-5 py-4 border-b border-[#2a2a2a] bg-[#161616]">
          <div className="flex items-center">
            <div className="w-8 h-8 rounded-full bg-[#6366f1] flex items-center justify-center mr-3 shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-white font-bold text-[15px]">Ask SignalStream</h3>
              <p className="text-gray-400 text-xs mt-0.5">Ask anything about your messages</p>
            </div>
          </div>
          <button 
            onClick={() => setIsOpen(false)}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded-md hover:bg-[#2a2a2a]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-5 bg-[#161616]">
          {/* User Message */}
          <div className="flex justify-end">
            <div className="bg-[#a5b4fc] text-[#0a0a0a] rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%] text-sm font-medium">
              What did the Rubrik recruiter say?
            </div>
          </div>

          {/* Assistant Message */}
          <div className="flex items-start">
            <div className="w-6 h-6 rounded-full bg-[#2a2a2a] flex items-center justify-center mr-2 shrink-0 mt-1">
              <Sparkles className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <div className="bg-[#222] border border-[#2a2a2a] text-gray-200 rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[85%] text-sm leading-relaxed">
              The Rubrik recruiter (Sarah Jenkins) mentioned that the Q4 budget approval is required and they need the final numbers for the SignalStream project by EOD tomorrow.
            </div>
          </div>

          {/* User Message */}
          <div className="flex justify-end">
            <div className="bg-[#a5b4fc] text-[#0a0a0a] rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%] text-sm font-medium">
              Did I get any urgent updates about the deployment?
            </div>
          </div>

          {/* Assistant Message */}
          <div className="flex items-start">
            <div className="w-6 h-6 rounded-full bg-[#2a2a2a] flex items-center justify-center mr-2 shrink-0 mt-1">
              <Sparkles className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <div className="bg-[#222] border border-[#2a2a2a] text-gray-200 rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[85%] text-sm leading-relaxed">
              Yes, dev-lead-alpha posted in #deployment 14m ago: "Emergency patch deployed to production. Monitoring latency on the US-East cluster."
            </div>
          </div>

          {/* Typing Indicator */}
          <div className="flex items-start">
            <div className="w-6 h-6 rounded-full bg-[#2a2a2a] flex items-center justify-center mr-2 shrink-0 mt-1">
              <Sparkles className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <div className="bg-[#222] border border-[#2a2a2a] text-gray-400 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
              <MoreHorizontal className="w-5 h-5 animate-pulse" />
            </div>
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-[#2a2a2a] bg-[#161616]">
          <div className="relative flex items-center">
            <input 
              type="text" 
              placeholder="Ask about your messages..." 
              className="w-full bg-[#222] border border-[#333] text-gray-200 text-sm rounded-full pl-5 pr-12 py-3 focus:outline-none focus:border-[#6366f1] transition-colors"
            />
            <button className="absolute right-1.5 w-8 h-8 rounded-full bg-[#818cf8] hover:bg-[#6366f1] text-[#0a0a0a] hover:text-white flex items-center justify-center transition-colors">
              <ArrowUp className="w-4 h-4 font-bold" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button 
      onClick={() => setIsOpen(true)}
      className="fixed bottom-6 right-6 w-14 h-14 bg-[#818cf8] hover:bg-[#6366f1] rounded-full flex items-center justify-center shadow-[0_4px_20px_rgba(99,102,241,0.2)] transition-transform hover:scale-105 z-50 text-[#0a0a0a] hover:text-white"
    >
      <MessageSquare className="w-6 h-6" fill="currentColor" />
    </button>
  );
}
