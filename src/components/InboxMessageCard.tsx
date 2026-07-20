import { useState } from 'react';
import { AtSign, MessageSquare, LayoutGrid, AlertCircle, Check, X } from 'lucide-react';
import { archiveMessage } from '../lib/api';
import { InboxMessage } from '../types';

interface InboxMessageCardProps {
  key?: string | number;
  message: InboxMessage;
}

export function InboxMessageCard({ message }: InboxMessageCardProps) {
  const [hidden, setHidden] = useState(false);

  const handleArchive = async () => {
    try {
      const result = await archiveMessage(message.id);
      if (result.ok) {
        setHidden(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getPlatformIcon = () => {
    switch (message.platform) {
      case 'Gmail': 
        return <div className="w-9 h-9 rounded-full bg-indigo-950/40 border border-indigo-900/40 flex items-center justify-center text-indigo-400"><AtSign className="w-4 h-4" /></div>;
      case 'WhatsApp': 
        return <div className="w-9 h-9 rounded-full bg-green-950/40 border border-green-900/40 flex items-center justify-center text-green-400"><MessageSquare className="w-4 h-4" /></div>;
      case 'Discord': 
        return <div className="w-9 h-9 rounded-full bg-indigo-950/40 border border-indigo-900/40 flex items-center justify-center text-indigo-400"><LayoutGrid className="w-4 h-4" /></div>;
      case 'Slack': 
        return <div className="w-9 h-9 rounded-full bg-red-950/40 border border-red-900/40 flex items-center justify-center text-red-400"><AlertCircle className="w-4 h-4" /></div>;
      default: return null;
    }
  };

  if (hidden) return null;

  return (
    <div className="bg-[#161616] border border-[#2a2a2a] hover:border-[#3a3a3a] rounded-xl p-4 transition-colors relative group cursor-pointer flex">
      <div className="mr-3.5 mt-0.5">
        {getPlatformIcon()}
      </div>
      
      <div className="flex-1 min-w-0 pr-20">
        <div className="flex justify-between items-start mb-1">
          <div className="flex items-baseline space-x-2 truncate pr-4">
            <span className="font-semibold text-gray-100 text-[15px]">{message.sender}</span>
            <span className="text-gray-500 text-xs">{message.source}</span>
          </div>
          <span className="text-gray-500 text-xs whitespace-nowrap absolute right-4 top-4">{message.timestamp}</span>
        </div>
        
        {message.subject && (
          <h4 className="text-white font-medium text-[15px] mb-1">{message.subject}</h4>
        )}
        <p className="text-gray-400 text-sm line-clamp-2 leading-relaxed">
          {message.preview}
        </p>
      </div>
      
      {/* Action Buttons (visible on hover) */}
      <div className="absolute right-4 bottom-4 flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={handleArchive} className="w-7 h-7 bg-[#2a2a2a] hover:bg-[#333] border border-[#333] hover:border-[#444] rounded flex items-center justify-center text-gray-400 hover:text-white transition-colors">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleArchive} className="w-7 h-7 bg-[#2a2a2a] hover:bg-[#333] border border-[#333] hover:border-[#444] rounded flex items-center justify-center text-gray-400 hover:text-white transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
