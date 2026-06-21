/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { 
  Upload, FileDown, FileText, CheckCircle2, AlertCircle, 
  Loader2, GraduationCap, Microscope, Stethoscope,
  MoveRight, BookOpen, Settings2, Key, Eye, EyeOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { convertMdToXMind } from './services/xmindConverter';
import { generateMedicalMap } from './services/geminiService';
import { extractTextFromPdf } from './services/pdfService';
import { supabase } from './services/supabaseClient';

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [studyFiles, setStudyFiles] = useState<File[]>([]);
  const [centralTopic, setCentralTopic] = useState('');
  const [objectives, setObjectives] = useState('');
  const [extension, setExtension] = useState(500);
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatedMd, setGeneratedMd] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // API Key State
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('GEMINI_API_KEY') || '');
  const [apiKeyInput, setApiKeyInput] = useState(() => localStorage.getItem('GEMINI_API_KEY') || '');
  const [apiKeySavedAt, setApiKeySavedAt] = useState<number | null>(null);
  const [showApiInput, setShowApiInput] = useState(false);
  const [showKey, setShowKey] = useState(false);
  
  const [isDragging, setIsDragging] = useState(false);
  
  const studyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const userEmail = useMemo(() => session?.user?.email as string | undefined, [session]);

  const signInWithGoogle = async () => {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`
      }
    });
    if (signInError) {
      setError(signInError.message);
    }
  };

  const signOut = async () => {
    setError(null);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
  };

  const confirmApiKey = () => {
    const trimmed = apiKeyInput.trim();
    setApiKey(trimmed);
    localStorage.setItem('GEMINI_API_KEY', trimmed);
    setApiKeySavedAt(Date.now());
  };

  const validateAndSetFiles = (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter(file => file.type === 'application/pdf');
    
    if (pdfs.length > 0) {
      setStudyFiles(prev => {
        // Prevent duplicates by checking name and size
        const newFiles = pdfs.filter(newF => 
          !prev.some(oldF => oldF.name === newF.name && oldF.size === newF.size)
        );
        return [...prev, ...newFiles];
      });
      setError(null);
    } else if (files.length > 0) {
      setError('Por favor, envie apenas arquivos PDF.');
    }
  };

  const removeFile = (index: number) => {
    setStudyFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) validateAndSetFiles(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files) validateAndSetFiles(files);
  };

  const handleGenerate = async () => {
    if (!apiKey) {
      setError('A API Key do Gemini é obrigatória para o funcionamento do app. Configure-a no topo da página.');
      setShowApiInput(true);
      return;
    }

    if (studyFiles.length === 0 || !objectives || !centralTopic) {
      setError('Por favor, carregue os materiais, insira o tópico central e os objetivos da tutoria.');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setGeneratedMd('');

    try {
      let fullStudyText = '';
      for (const file of studyFiles) {
        const text = await extractTextFromPdf(file);
        fullStudyText += `\n--- SOURCE: ${file.name} ---\n${text}\n`;
      }
      
      const result = await generateMedicalMap(fullStudyText, objectives, extension, centralTopic, apiKey);
      setGeneratedMd(result);
      
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#4f46e5', '#0ea5e9', '#06b6d4']
      });
    } catch (err: any) {
      console.error(err);
      const errorMessage = err?.message || 'Ocorreu um erro desconhecido.';
      if (errorMessage.includes('toHex')) {
        setError('Erro de compatibilidade do PDF no seu dispositivo. Tente usar outro navegador ou computador.');
      } else if (errorMessage.toLowerCase().includes('api key') || errorMessage.toLowerCase().includes('apikey')) {
        setError('Sua Gemini API Key parece inválida ou não foi configurada corretamente.');
        setShowApiInput(true);
      } else if (errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('429')) {
        setError('Cota excedida na API do Gemini. Tentamos 5 vezes sem sucesso. Tente novamente em alguns minutos.');
      } else {
        setError(`Erro: ${errorMessage}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };


  const handleDownloadXMind = async () => {
    if (!generatedMd) return;
    try {
      const blob = await convertMdToXMind(generatedMd);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MedMap_${Date.now()}.xmind`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('Erro ao converter para XMind.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20 selection:bg-indigo-100">
      {/* Header Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2 md:space-x-3">
            <div className="bg-indigo-600 p-1.5 md:p-2 rounded-xl">
              <Microscope className="w-4 h-4 md:w-5 md:h-5 text-white" />
            </div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-600 to-sky-600 bg-clip-text text-transparent">
              Synapses App
            </h1>
          </div>
          
          <div className="flex items-center space-x-3 md:space-x-6">
            <div className="flex items-center space-x-4 text-sm text-slate-500 font-medium hidden lg:flex">
              <span className="flex items-center"><Stethoscope className="w-4 h-4 mr-1" /> Óptica Médica</span>
              <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
              <span className="flex items-center"><GraduationCap className="w-4 h-4 mr-1" /> Rigor Acadêmico</span>
            </div>

            <div className="hidden md:flex items-center space-x-2">
              {authLoading ? (
                <span className="text-xs text-slate-400 font-semibold">Carregando...</span>
              ) : session ? (
                <>
                  <span className="text-xs text-slate-500 font-semibold max-w-56 truncate">{userEmail}</span>
                  <button
                    onClick={signOut}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all"
                  >
                    Sair
                  </button>
                </>
              ) : (
                <button
                  onClick={signInWithGoogle}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all"
                >
                  Entrar com Google
                </button>
              )}
            </div>

            <div className="relative">
              <button 
                onClick={() => setShowApiInput(!showApiInput)}
                className={`flex items-center space-x-1.5 md:space-x-2 px-2.5 md:px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  apiKey ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Key className="w-3.5 h-3.5" />
                <span className="md:inline hidden">API {apiKey ? 'Configurada' : ''}</span>
                <span className="md:hidden">API</span>
              </button>

              <AnimatePresence>
                {showApiInput && (
                  <>
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setShowApiInput(false)}
                      className="fixed inset-0 bg-slate-900/10 backdrop-blur-[1px] z-[55] md:hidden"
                    />
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-[calc(100vw-2rem)] md:w-72 bg-white border border-slate-200 rounded-2xl shadow-2xl p-5 z-[60] -mr-0"
                    >
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Configuração da API</span>
                          <button onClick={() => setShowApiInput(false)} className="text-slate-300 hover:text-slate-500 p-1">×</button>
                        </div>
                        <div className="relative">
                          <input 
                            type={showKey ? "text" : "password"}
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                            placeholder="Insira sua Gemini API Key..."
                            className="w-full bg-slate-50 border border-slate-100 rounded-xl py-2 px-3 pr-10 text-xs focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all"
                          />
                          <button 
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                          >
                            {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            confirmApiKey();
                            setShowApiInput(false);
                          }}
                          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 rounded-xl transition-all"
                        >
                          Confirmar API Key
                        </button>
                        {apiKeySavedAt && (
                          <p className="text-[9px] text-green-700 bg-green-50 border border-green-100 rounded-xl px-3 py-2 leading-tight">
                            API Key confirmada com sucesso.
                          </p>
                        )}
                        <p className="text-[9px] text-slate-400 leading-tight">
                          Sua chave fica salva apenas no seu navegador. Obtenha uma em <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-indigo-500 underline">AI Studio</a>.
                        </p>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 grid lg:grid-cols-12 gap-8">
        {!authLoading && !session ? (
          <div className="lg:col-span-12">
            {error && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center space-x-2 bg-red-50 text-red-700 p-4 rounded-2xl border border-red-100 text-sm mb-6">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <p>{error}</p>
              </motion.div>
            )}
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center space-x-2 text-indigo-600 mb-3">
                <Key className="w-5 h-5" />
                <h2 className="font-semibold text-lg">Faça login para continuar</h2>
              </div>
              <p className="text-sm text-slate-600 mb-6">
                Entre com sua conta Google para acessar o app.
              </p>
              <button
                onClick={signInWithGoogle}
                className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-5 py-3 rounded-2xl transition-all"
              >
                Entrar com Google
              </button>
            </div>
          </div>
        ) : authLoading ? (
          <div className="lg:col-span-12">
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex items-center space-x-3 text-slate-600">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm font-semibold">Carregando sessão...</span>
            </div>
          </div>
        ) : (
          <>
            <div className="lg:col-span-12">
              {error && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center space-x-2 bg-red-50 text-red-700 p-4 rounded-2xl border border-red-100 text-sm mb-6">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <p>{error}</p>
                </motion.div>
              )}
            </div>

            {/* Left Column: Inputs */}
            <div className="lg:col-span-5 space-y-8 order-1">
              <section className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                <div className="flex items-center space-x-2 text-indigo-600 mb-2">
                  <BookOpen className="w-5 h-5" />
                  <h2 className="font-semibold text-lg">Insira Abaixo os Materiais</h2>
                </div>
            
            {/* Uploaders */}
            <div className="space-y-4">
              <div 
                onClick={() => studyInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`w-full cursor-pointer flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed transition-all ${
                  isDragging ? 'border-indigo-400 bg-indigo-50/50 scale-[1.01]' :
                  studyFiles.length > 0 ? 'border-green-200 bg-green-50/30 text-green-700' : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 text-slate-500'
                }`}
              >
                <input ref={studyInputRef} type="file" className="hidden" accept=".pdf" multiple onChange={handleFileUpload} />
                <Upload className="w-8 h-8 mb-3" />
                <span className="text-sm font-bold uppercase tracking-wider">Materiais</span>
                <p className="text-[10px] mt-1 text-slate-400">PDFs de livros, artigos ou apostilas</p>
                <p className="text-[10px] text-slate-400">(Vários arquivos permitidos)</p>
              </div>

              {studyFiles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Arquivos Selecionados ({studyFiles.length})</p>
                  <div className="max-h-40 overflow-y-auto space-y-1.5 p-1">
                    {studyFiles.map((file, idx) => (
                      <div key={`${file.name}-${idx}`} className="flex items-center justify-between bg-white border border-slate-100 rounded-xl p-2 px-3 shadow-sm group">
                        <div className="flex items-center space-x-2 min-w-0">
                          <FileText className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                          <span className="text-xs font-medium text-slate-600 truncate">{file.name}</span>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                          className="text-slate-300 hover:text-red-500 transition-colors p-1"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Central Topic */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1">Tópico Central do Mapa</label>
              <input 
                type="text"
                value={centralTopic}
                onChange={(e) => setCentralTopic(e.target.value)}
                placeholder="Ex: Insuficiência Cardíaca, Diabetes Mellitus..."
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-semibold focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all"
              />
            </div>

            {/* Objectives */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1 flex flex-wrap items-baseline gap-2">
                Objetivos da Tutoria
                <span className="text-[10px] font-medium text-slate-400 leading-none uppercase italic">
                  (Caso algum objetivo tenha mais de um comando, sugiro separar)
                </span>
              </label>
              <textarea 
                value={objectives}
                onChange={(e) => setObjectives(e.target.value)}
                placeholder="Ex: 1. Fisiopatologia da ICC; 2. Classificação de NYHA..."
                className="w-full h-32 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all resize-none"
              />
            </div>

            {/* Extension Slider */}
            <div className="space-y-3">
              <div className="flex justify-between items-center px-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex flex-wrap items-baseline gap-1">
                  Tamanho do Mapa 
                  <span className="text-[10px] font-medium text-slate-400 leading-none">
                    (Tamanho recomendado: 200 a 300 palavras por objetivo)
                  </span>
                </label>
                <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">{extension} palavras</span>
              </div>
              <input 
                type="range" min="500" max="2000" step="50"
                value={extension}
                onChange={(e) => setExtension(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>

            <button 
              onClick={handleGenerate}
              disabled={isProcessing}
              className="w-full bg-indigo-600 hover:bg-slate-900 text-white py-4 rounded-2xl font-bold text-sm shadow-xl shadow-indigo-100 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sintetizando Conhecimento...</span>
                </>
              ) : (
                <>
                  <MoveRight className="w-4 h-4" />
                  <span>Gerar Mapa Mental</span>
                </>
              )}
            </button>
          </section>

          {error && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center space-x-2 bg-red-50 text-red-700 p-4 rounded-2xl border border-red-100 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p>{error}</p>
            </motion.div>
          )}
        </div>

        {/* Right Column: Output Area */}
        <div className="lg:col-span-7 order-2 lg:order-last">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[500px] md:h-[700px]">
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <AnimatePresence mode="wait">
                {!generatedMd && !isProcessing && (
                  <motion.div 
                    key="idle"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="space-y-6 max-w-sm"
                  >
                    <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                      <GraduationCap className="w-12 h-12 text-slate-200" />
                    </div>
                    <div>
                      <h3 className="text-slate-900 font-bold text-xl mb-2">Pronto para Começar</h3>
                      <p className="text-slate-400 text-sm leading-relaxed">
                        Carregue seus materiais e defina os objetivos para gerar o seu mapa mental estruturado.
                      </p>
                    </div>
                  </motion.div>
                )}

                {isProcessing && (
                  <motion.div 
                    key="processing"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-6"
                  >
                    <div className="relative mx-auto w-24 h-24">
                      <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                      <Microscope className="w-10 h-10 text-indigo-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-indigo-600 font-bold text-xl animate-pulse">Sintetizando Dados</h3>
                      <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">
                        {extension > 1200 
                          ? "Construindo Mapa Detalhado (Aguarde...)" 
                          : "Aplicando Rigor Acadêmico..."}
                      </p>
                    </div>
                  </motion.div>
                )}

                {generatedMd && !isProcessing && (
                  <motion.div 
                    key="success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-8 max-w-md w-full"
                  >
                    <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-12 h-12 text-green-600" />
                    </div>
                    <div>
                      <h3 className="text-slate-900 font-bold text-2xl mb-2">Mapa Mental Concluído</h3>
                      <p className="text-slate-500 mb-8">
                        A estrutura do seu mapa foi gerada com sucesso e está pronta para ser importada no XMind.
                      </p>
                      
                      <div className="grid grid-cols-1 gap-4">
                        <button 
                          onClick={handleDownloadXMind}
                          className="w-full bg-green-600 hover:bg-green-700 text-white py-5 rounded-2xl font-bold flex items-center justify-center space-x-3 shadow-lg shadow-green-100 transition-all active:scale-95"
                        >
                          <FileDown className="w-6 h-6" />
                          <span className="text-lg">Baixar MedMap (.xmind)</span>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
          </>
        )}
      </main>
    </div>
  );
}
