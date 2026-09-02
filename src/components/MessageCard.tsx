// Compact message card used by the legacy Priority feed (sender/channel + match badges).
import { useState } from 'react';
import { Mail, MessageSquare, Check, X } from 'lucide-react';
import { archiveMessage } from '../lib/api';
import { Message } from '../types';

interface MessageCardProps {
  key?: string | number;
  message: Message;
}

export function MessageCard({ message }: MessageCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [hidden, setHidden] = useState(false);

  const getPlatformIcon = () => {
    switch (message.platform) {
      case 'Gmail':
        return (
          <div className="w-9 h-9 rounded-xl bg-red-950/40 flex items-center justify-center border border-red-900/50 flex-shrink-0">
            <Mail className="w-4 h-4 text-red-400" />
          </div>
        );
      case 'WhatsApp':
        return (
          <div className="w-9 h-9 rounded-xl bg-green-950/40 flex items-center justify-center border border-green-900/50 flex-shrink-0">
            <MessageSquare className="w-4 h-4 text-green-400" />
          </div>
        );
      default:
        return null;
    }
  };

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

  if (hidden) return null;

  return (
    <div 
      className="bg-[#111] border border-[#222] hover:border-[#333] rounded-xl p-3.5 transition-colors relative group flex cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="mr-3.5">
        {getPlatformIcon()}
      </div>
      
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-baseline space-x-2 truncate">
            <span className="font-semibold text-gray-100 text-[15px]">{message.sender}</span>
            <span className="text-gray-500 text-sm">{message.source}</span>
          </div>
          
          <div className="flex items-center space-x-2">
            {isHovered && (
              <div className="flex items-center space-x-1 mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={handleArchive} className="p-1.5 text-gray-500 hover:text-green-400 hover:bg-green-950/30 rounded-lg transition-colors">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={handleArchive} className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <span className="text-gray-500 text-xs whitespace-nowrap">{message.timestamp}</span>
          </div>
        </div>
        
        <p className="text-gray-400 text-sm truncate mb-3">{message.preview}</p>
        
        <div className="flex flex-wrap gap-2">
          {message.matches.map((match, idx) => (
            <span 
              key={idx}
              className={`inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase border ${
                match.color === 'red' 
                  ? 'bg-red-950/30 text-red-400 border-red-900/30' 
                  : 'bg-indigo-950/30 text-indigo-400 border-indigo-900/30'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${match.color === 'red' ? 'bg-red-500' : 'bg-indigo-500'}`}></span>
              MATCHED: {match.keyword}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
