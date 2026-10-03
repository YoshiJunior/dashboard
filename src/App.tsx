import { ReactNode, useCallback, useEffect, useState } from "react";
import { Field, FilePicker, ActionButton, assets } from "./ui";
import { HomePage, LoginScreen, MessagePage, PostPage, SettingsPage, useAuth, useUnread } from "./pages";
import { configured } from "./supabase";
import { Game, addGame, changeGame, getCfg, isExternal, loadGames, removeGame, saveCfg } from "./github";

type Page = "home" | "post" | "add" | "edit" | "remove" | "message" | "settings";


const navItems: { id: Page; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "373eb.svg" },
  { id: "post", label: "Post", icon: "196a9.svg" },
  { id: "add", label: "Add", icon: "3e0c1.svg" },
  { id: "edit", label: "Edit", icon: "31e6c.svg" },
  { id: "remove", label: "Remove", icon: "67d11.svg" },
  { id: "message", label: "Message", icon: "515c4.svg" },
  { id: "settings", label: "Settings", icon: "dd84b.svg" },
];

const adminPages: Page[] = ["post", "add", "edit", "remove"];

function Sidebar({ page, onNavigate, admin, unread }: { page: Page; onNavigate: (page: Page) => void; admin: boolean; unread: number }) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <button className="brand" onClick={() => onNavigate("home")} aria-label="Go home">
        <img src={`${assets}/39348.png`} alt="Yoshi" />
      </button>
      <nav>
        {navItems.filter((item) => admin || !adminPages.includes(item.id)).map((item) => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
            aria-current={page === item.id ? "page" : undefined}
          >
            <span className="nav-icon">
              <img src={`${assets}/${item.icon}`} alt="" />
              {item.id === "home" && unread > 0 && <span className="badge">{unread > 9 ? "9+" : unread}</span>}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

function ProgressLog({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <div className="progress-log" aria-live="polite">
      {lines.map((line, index) => (
        <span key={index}>{line}</span>
      ))}
    </div>
  );
}

function useGames(notify: (text: string) => void, active: boolean) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setGames(await loadGames(getCfg()));
    } catch (error) {
      setGames([]);
      notify((error as Error).message.split("\n")[0]);
    } finally {
      setLoading(false);
    }
  }, [notify]);
  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);
  return { games, loading, reload };
}

function GamePicker({
  games,
  loading,
  selected,
  onChoose,
}: {
  games: Game[];
  loading: boolean;
  selected: Game | null;
  onChoose: (game: Game) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="game-picker">
      <button className="select-field" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {selected ? selected.title : loading ? "Loading games..." : "Choose Game"} <span className="caret" />
      </button>
      {open && (
        <div className="game-menu" role="listbox">
          {games.length === 0 && <div className="game-menu-empty">{loading ? "Loading..." : "No games found"}</div>}
          {games.map((game, index) => (
            <button
              key={`${game.url}-${index}`}
              type="button"
              role="option"
              aria-selected={selected === game}
              onClick={() => {
                onChoose(game);
                setOpen(false);
              }}
            >
              <span>{game.title}</span>
              <small>{isExternal(game.url) ? "external link" : game.url}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GameForm({ mode, notify }: { mode: "add" | "edit"; notify: (text: string) => void }) {
  const [name, setName] = useState("");
  const [gameLink, setGameLink] = useState("");
  const [imageLink, setImageLink] = useState("");
  const [gameFile, setGameFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<Game | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const { games, loading, reload } = useGames(notify, mode === "edit");

  const upload = async () => {
    if (working) return;
    const cfg = getCfg();
    if (!cfg.token) return notify("Add your GitHub token in Settings first");
    const log = (message: string) => setLines((current) => [...current, message]);
    setLines([]);
    setWorking(true);
    try {
      const input = { title: name, file: gameFile, link: gameLink, imgF: imageFile, imgU: imageLink };
      if (mode === "add") await addGame(cfg, input, log);
      else await changeGame(cfg, selected, input, log);
      log("Done. GitHub Pages can take a minute to show the update.");
      notify(mode === "add" ? "Game uploaded successfully" : "Game changes published");
      setName("");
      setGameLink("");
      setImageLink("");
      setGameFile(null);
      setImageFile(null);
      setResetKey((key) => key + 1);
      if (mode === "edit") {
        setSelected(null);
        void reload();
      }
    } catch (error) {
      const message = (error as Error).message;
      log(`Error: ${message}`);
      notify(message.split("\n")[0]);
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="center-panel game-form">
      {mode === "edit" && (
        <GamePicker
          games={games}
          loading={loading}
          selected={selected}
          onChoose={(game) => {
            setSelected(game);
            setName(game.title);
          }}
        />
      )}
      <Field value={name} onChange={setName} placeholder={mode === "edit" ? "New Title" : "Game Name"} />
      <div className="source-row">
        <FilePicker key={`g${resetKey}`} label="Upload Game" accept=".html,text/html" selected={gameFile?.name} onSelect={setGameFile} />
        <strong>or</strong>
        <Field value={gameLink} onChange={setGameLink} placeholder="Game Link" />
      </div>
      <div className="source-row">
        <FilePicker key={`i${resetKey}`} label="Upload Image" accept="image/*" selected={imageFile?.name} onSelect={setImageFile} />
        <strong>or</strong>
        <Field value={imageLink} onChange={setImageLink} placeholder="Game Image" />
      </div>
      <ActionButton tone={mode === "edit" ? "yellow" : "green"} onClick={upload}>
        {working ? "Working..." : mode === "edit" ? "Save Changes" : "Upload"}
      </ActionButton>
      <ProgressLog lines={lines} />
    </section>
  );
}

function RemovePage({ notify }: { notify: (text: string) => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [selected, setSelected] = useState<Game | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const { games, loading, reload } = useGames(notify, true);

  const remove = async () => {
    if (working) return;
    const cfg = getCfg();
    if (!cfg.token) return notify("Add your GitHub token in Settings first");
    if (!selected) return notify("Choose a game first");
    if (!confirmed) return notify("Confirm removal first");
    const log = (message: string) => setLines((current) => [...current, message]);
    setLines([]);
    setWorking(true);
    try {
      await removeGame(cfg, selected, log);
      log("Done. GitHub Pages can take a minute to show the update.");
      notify("Game removed");
      setSelected(null);
      setConfirmed(false);
      void reload();
    } catch (error) {
      const message = (error as Error).message;
      log(`Error: ${message}`);
      notify(message.split("\n")[0]);
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="center-panel remove-page">
      <GamePicker games={games} loading={loading} selected={selected} onChoose={setSelected} />
      <label className="confirm-row">
        <input type="checkbox" checked={confirmed} onChange={() => setConfirmed(!confirmed)} />
        <span>I want to remove {selected ? `"${selected.title}"` : "this game"}</span>
      </label>
      <ActionButton tone="red" onClick={remove}>
        {working ? "Removing..." : "Remove"}
      </ActionButton>
      <ProgressLog lines={lines} />
    </section>
  );
}

export default function App() {
  const { session, profile, setProfile, loading } = useAuth();
  const [page, setPage] = useState<Page>("home");
  const [toast, setToast] = useState("");
  const [transitionKey, setTransitionKey] = useState(0);
  const userId = session?.user.id;
  const unread = useUnread(userId);
  const admin = !configured || profile?.role === "admin";

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const notify = useCallback((text: string) => setToast(text), []);
  const navigate = (next: Page) => {
    if (next === page) return;
    setPage(next);
    setTransitionKey((key) => key + 1);
  };

  if (configured && loading) return <div className="app-shell" aria-busy="true" />;
  if (configured && !session) return <LoginScreen />;
  if (configured && !profile) return <div className="app-shell" aria-busy="true" />;

  let content: ReactNode;
  if (adminPages.includes(page) && !admin) content = <section className="center-panel"><p className="empty-note">Admins only.</p></section>;
  else if (page === "home") content = configured && userId ? <HomePage notify={notify} userId={userId} /> : <section className="notifications-page"><h1>Notifications</h1><p className="empty-note">Connect Supabase to enable notifications.</p></section>;
  else if (page === "post") content = userId ? <PostPage notify={notify} userId={userId} /> : <section className="center-panel"><p className="empty-note">Connect Supabase to publish posts.</p></section>;
  else if (page === "add" || page === "edit") content = <GameForm mode={page} notify={notify} />;
  else if (page === "remove") content = <RemovePage notify={notify} />;
  else if (page === "message") content = userId ? <MessagePage notify={notify} userId={userId} /> : <section className="center-panel"><p className="empty-note">Connect Supabase to message.</p></section>;
  else content = <SettingsPage notify={notify} profile={profile} onProfile={setProfile} isAdmin={admin} />;

  return (
    <div className="app-shell">
      <Sidebar page={page} onNavigate={navigate} admin={admin} unread={unread} />
      <main className="page-stage" key={transitionKey}>{content}</main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
