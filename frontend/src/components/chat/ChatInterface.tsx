'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { Message } from '@/types';
import { api } from '@/lib/api';
import MessageBubble from '@/components/chat/MessageBubble';

interface ChatInterfaceProps {
  conversationId: string;
  agentId: string;
}

export default function ChatInterface({ conversationId, agentId }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = '';
    if (!files || files.length === 0 || isUploading) return;

    if (files.length > 5) {
      alert('Maximum 5 images per upload.');
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    for (const f of Array.from(files)) {
      if (!validTypes.includes(f.type)) {
        alert(`Unsupported type: ${f.name}. Use JPEG, PNG, GIF or WebP.`);
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        alert(`${f.name} is too large — images up to 10 MB are supported.`);
        return;
      }
    }

    setIsUploading(true);
    try {
      const images = await Promise.all(
        Array.from(files).map(
          (file) =>
            new Promise<{ base64: string; mediaType: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                resolve({ base64: result.split(',')[1] || '', mediaType: file.type });
              };
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            })
        )
      );

      const userContent = input.trim() || 'Process this image.';
      setInput('');

      const tempUserMsg: Message = {
        id: `temp-img-${Date.now()}`,
        conversation_id: conversationId,
        role: 'user',
        content: `[Image${images.length > 1 ? 's' : ''} attached] ${userContent}`,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempUserMsg]);
      setIsSending(true);

      const data = await api.uploadImage(conversationId, userContent, images);
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempUserMsg.id);
        return [...withoutTemp, data.message, data.reply];
      });
    } catch (err: any) {
      console.error('Image upload failed:', err);
      alert(`Image upload failed: ${err.message || 'unknown error'}`);
    } finally {
      setIsUploading(false);
      setIsSending(false);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isUploading) return;

    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pdf') && !lower.endsWith('.docx')) {
      alert(lower.endsWith('.doc')
        ? 'Old-format .doc files are not supported. Save as .docx or PDF first.'
        : 'Only PDF and Word (.docx) files are supported.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      alert('File too large — contracts up to 20 MB are supported.');
      return;
    }

    setIsUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] || '');
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      const data = await api.uploadContract(conversationId, file.name, base64);
      setMessages((prev) => [...prev, data.message]);
    } catch (err: any) {
      console.error('Upload failed:', err);
      alert(`Upload failed: ${err.message || 'unknown error'}`);
    } finally {
      setIsUploading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!conversationId) return;
    setIsLoading(true);
    api
      .getConversation(conversationId)
      .then((data) => {
        setMessages(data.messages || []);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [conversationId]);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const content = input.trim();
    if (!content || isSending) return;

    setInput('');
    setIsSending(true);

    // Optimistically add user message
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: conversationId,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const data = await api.sendMessage(conversationId, content);
      // Replace temp message and add reply
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempUserMsg.id);
        return [...withoutTemp, data.message, data.reply];
      });
      setIsSending(false);
    } catch (err) {
      console.error('Connection dropped, polling for the reply:', err);
      // Long tasks (e.g. contract reviews) can outlive the connection while the
      // server keeps working. Poll the conversation until the reply appears.
      const baseline = messages.length + 1; // + our message
      let found = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((r) => setTimeout(r, 15000));
        try {
          const data = await api.getConversation(conversationId);
          const all = data.messages || [];
          if (all.length > baseline && all[all.length - 1].role === 'assistant') {
            setMessages(all);
            found = true;
            break;
          }
        } catch { /* keep polling */ }
      }
      if (!found) {
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
        setInput(content); // Restore input so nothing is lost
        alert('The reply is taking unusually long. Refresh the page in a minute — it may still arrive.');
      }
      setIsSending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-omnii-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center h-full">
            <p className="text-surface-600 text-sm">No messages yet. Start the conversation.</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isSending && (
          <div className="flex justify-start">
            <div className="bg-dark-3 border border-dark-4 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <div className="w-2 h-2 bg-surface-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-surface-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-surface-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-dark-4">
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileSelected}
            className="hidden"
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            onChange={handleImageSelected}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={isUploading || isSending}
            title="Attach image(s) — badge photos, screenshots"
            className="btn-primary px-3"
          >
            {isUploading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || isSending}
            title="Attach a contract (PDF or Word)"
            className="btn-primary px-3"
          >
            {isUploading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
              </svg>
            )}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="input-field flex-1"
            disabled={isSending}
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="btn-primary px-4"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
