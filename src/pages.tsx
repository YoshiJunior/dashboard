import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Profile, configured, supabase } from "./supabase";
import { getCfg, saveCfg } from "./github";
import { ActionButton, FilePicker, Toggle, assets } from "./ui";

type Notify = (text: string) => void;
const fail = (error: unknown) => (error instanceof Error ? error.message : (error as { message?: string })?.message || "Something went wrong");

/* ---------- auth ---------- */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(configured);
  const userId = session?.user.id;

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return setProfile(null);
    supabase.from("profiles").select("*").eq("id", userId).single().then(({ data }) => setProfile(data as Profile | null));
  }, [userId]);

  return { session, profile, setProfile, loading };
}

export function useUnread(userId?: string) {
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    if (!userId) return setCount(0);
    const { count: total } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null);
    setCount(total || 0);
  }, [userId]);
  useEffect(() => {
    void refresh();
    if (!userId) return;
    const channel = supabase
      .channel(`unread-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => void refresh())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [userId, refresh]);
  return count;
}

export function LoginScreen({ error }: { error?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error || "");
  const signIn = async () => {
    setBusy(true);
    const { error: failure } = await supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: window.location.origin + import.meta.env.BASE_URL } });
    if (failure) {
      setMessage(failure.message);
      setBusy(false);
    }
  };
  return (
    <main className="login">
      <img src={`${assets}/39348.png`} alt="Yoshi" />
      <h1>Yoshi&apos;s Dashboard</h1>
      <ActionButton onClick={signIn}>{busy ? "Redirecting..." : "Sign in with GitHub"}</ActionButton>
      {message && <p role="alert">{message}</p>}
    </main>
  );
}

/* ---------- home / notifications ---------- */
type Note = { id: string; title: string; body: string | null; read_at: string | null; created_at: string };

export function HomePage({ notify, userId }: { notify: Notify; userId: string }) {
  const [items, setItems] = useState<Note[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error: failure } = await supabase.from("notifications").select("id,title,body,read_at,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
    if (failure) setError(failure.message);
    else {
      setError("");
      setItems(data as Note[]);
    }
  }, [userId]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`home-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [userId, load]);

  const markRead = async (id?: string) => {
    const now = new Date().toISOString();
    let query = supabase.from("notifications").update({ read_at: now }).eq("user_id", userId).is("read_at", null);
    if (id) query = query.eq("id", id);
    const { error: failure } = await query;
    if (failure) return notify(failure.message);
    setItems((current) => current && current.map((n) => (!id || n.id === id ? { ...n, read_at: n.read_at || now } : n)));
    if (!id) notify("All notifications marked read");
  };

  return (
    <section className="notifications-page">
      <h1>Notifications</h1>
      {error && <p className="inline-error" role="alert">{error} <button onClick={() => void load()}>Retry</button></p>}
      {!items && !error && (
        <div className="notification-list">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className={`notification-skeleton ${i === 5 ? "fade" : ""}`} />)}
        </div>
      )}
      {items && items.length === 0 && <p className="empty-note">You&apos;re all caught up.</p>}
      {items && items.length > 0 && (
        <>
          <button className="link-action" onClick={() => void markRead()}>Mark all read</button>
          <div className="notification-list">
            {items.map((n) => (
              <button key={n.id} className={`notification-item ${n.read_at ? "" : "unread"}`} onClick={() => void markRead(n.id)}>
                <strong>{n.title}</strong>
                {n.body && <span>{n.body}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/* ---------- post (admin) ---------- */
export function PostPage({ notify, userId }: { notify: Notify; userId: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [banner, setBanner] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!banner) return setPreview("");
    const url = URL.createObjectURL(banner);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [banner]);

  const publish = async () => {
    if (working) return;
    if (!title.trim() || !body.trim()) return notify("Add a title and description");
    if (!banner) return notify("Choose a banner image");
    if (!banner.type.startsWith("image/") || banner.size > 5 * 1024 * 1024) return notify("Banner must be an image under 5 MB");
    setWorking(true);
    const id = crypto.randomUUID();
    const path = `posts/${id}/banner.${(banner.name.split(".").pop() || "png").toLowerCase()}`;
    try {
      const up = await supabase.storage.from("post-banners").upload(path, banner, { contentType: banner.type });
      if (up.error) throw new Error(`Banner upload failed: ${up.error.message}`);
      const ins = await supabase.from("posts").insert({ id, title: title.trim(), body: body.trim(), banner_path: path, status: "published", created_by: userId });
      if (ins.error) {
        await supabase.storage.from("post-banners").remove([path]);
        throw new Error(`Saving post failed: ${ins.error.message}`);
      }
      notify("Post uploaded successfully");
      setTitle("");
      setBody("");
      setBanner(null);
    } catch (error) {
      notify(fail(error));
    } finally {
      setWorking(false);
    }
  };

  const shown = preview || `${assets}/f0346.png`;
  return (
    <section className="post-page">
      <div className="post-editor">
        <div className="banner-card">
          <h1><img src={`${assets}/a73a0.svg`} alt="" /> Add Banner</h1>
          <FilePicker label="Upload File" accept="image/*" selected={banner?.name} onSelect={setBanner} />
          <div className="banner-strip">
            {[0, 1, 2, 3].map((i) => <button className={i === 0 ? "selected" : ""} key={i}><img src={shown} alt="Banner preview" /></button>)}
          </div>
        </div>
        <div className="copy-card">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add Title" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your post..." />
        </div>
      </div>
      <article className="post-preview">
        <img src={shown} alt="Post banner" />
        <h2>{title || "No Title!"}</h2>
        <p>{body}</p>
      </article>
      <div className="post-submit">
        <ActionButton onClick={() => void publish()}>{working ? "Uploading..." : "Upload"}</ActionButton>
      </div>
    </section>
  );
}

/* ---------- messages ---------- */
type Person = { id: string; display_name: string; avatar_url: string | null };
type Msg = { id: string; sender_id: string; body: string; created_at: string; pending?: boolean; failed?: boolean };

export function MessagePage({ notify, userId }: { notify: Notify; userId: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [active, setActive] = useState<Person | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    supabase.from("profiles").select("id,display_name,avatar_url").neq("id", userId).order("display_name").then(({ data, error }) => {
      if (error) notify(error.message);
      else setPeople(data as Person[]);
    });
  }, [userId, notify]);

  const open = async (person: Person) => {
    setActive(person);
    setConvId(null);
    setMessages([]);
    const { data, error } = await supabase.rpc("start_conversation", { other: person.id });
    if (error) return notify(error.message);
    setConvId(data as string);
  };

  useEffect(() => {
    if (!convId) return;
    let gone = false;
    supabase.from("messages").select("id,sender_id,body,created_at").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(100).then(({ data, error }) => {
      if (gone) return;
      if (error) notify(error.message);
      else setMessages((data as Msg[]).reverse());
    });
    const channel = supabase
      .channel(`conv-${convId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` }, (payload) => {
        const row = payload.new as Msg;
        setMessages((current) => {
          if (current.some((m) => m.id === row.id)) return current;
          const pendingIndex = current.findIndex((m) => m.pending && m.body === row.body && row.sender_id === userId);
          if (pendingIndex >= 0) return current.map((m, i) => (i === pendingIndex ? row : m));
          return [...current, row];
        });
      })
      .subscribe();
    return () => {
      gone = true;
      void supabase.removeChannel(channel);
    };
  }, [convId, userId, notify]);

  useEffect(() => {
    if (stick.current) box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [messages]);

  const send = async (event: FormEvent, retry?: Msg) => {
    event.preventDefault();
    const text = (retry?.body ?? draft).trim();
    if (!text || !convId || sending) return;
    const temp: Msg = { id: `tmp-${Date.now()}`, sender_id: userId, body: text, created_at: new Date().toISOString(), pending: true };
    setMessages((current) => [...current.filter((m) => m.id !== retry?.id), temp]);
    setDraft("");
    setSending(true);
    const { data, error } = await supabase.from("messages").insert({ conversation_id: convId, sender_id: userId, body: text }).select("id,sender_id,body,created_at").single();
    setSending(false);
    if (error) {
      setMessages((current) => current.map((m) => (m.id === temp.id ? { ...m, pending: false, failed: true } : m)));
      return notify(error.message);
    }
    setMessages((current) => {
      const real = data as Msg;
      const withoutTemp = current.filter((m) => m.id !== temp.id);
      return withoutTemp.some((m) => m.id === real.id) ? withoutTemp : [...withoutTemp, real];
    });
  };

  return (
    <section className="message-page">
      <div className="conversation">
        <div
          className="chat-scroll"
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="chat-spacer" />
          {!active && <p className="empty-note">Choose someone to start chatting.</p>}
          {active && convId && messages.length === 0 && <p className="empty-note">No messages yet. Say hi!</p>}
          {messages.map((m) => (
            <div className={`bubble ${m.sender_id === userId ? "outgoing" : "incoming"}`} key={m.id} style={m.pending ? { opacity: 0.6 } : undefined}>
              {m.body}
              {m.failed && <button className="link-action" onClick={(e) => void send(e, m)}>Failed, retry</button>}
            </div>
          ))}
        </div>
        <form className="composer" onSubmit={(e) => void send(e)}>
          <button type="button" aria-label="Add attachment" onClick={() => notify("Attachments are not supported yet")}>
            <img src={`${assets}/ad3d6.svg`} alt="" />
          </button>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Start typing..." disabled={!convId} />
          <button className="gif" type="button" onClick={() => notify("GIFs are not supported yet")}>GIF</button>
          <button type="submit" aria-label="Send message" disabled={!convId || sending}><img src={`${assets}/8536e.svg`} alt="" /></button>
        </form>
      </div>
      <div className="people-list">
        {people.length === 0 && <p className="empty-note">No other users yet.</p>}
        {people.map((p) => (
          <button className={active?.id === p.id ? "selected" : ""} key={p.id} onClick={() => void open(p)}>
            <img src={p.avatar_url || `${assets}/14061.png`} alt="" />
            <span>{p.display_name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------- settings ---------- */
export function SettingsPage({ notify, profile, onProfile, isAdmin }: { notify: Notify; profile: Profile | null; onProfile: (p: Profile) => void; isAdmin: boolean }) {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("yoshi-theme") !== "light"; } catch { return true; }
  });
  const [cfg, setCfg] = useState(getCfg);
  const update = (key: keyof typeof cfg) => (event: ChangeEvent<HTMLInputElement>) => setCfg((c) => ({ ...c, [key]: event.target.value }));
  const save = (label: string) => () => {
    saveCfg({ ...cfg, owner: cfg.owner.trim(), repo: cfg.repo.trim(), branch: cfg.branch.trim() || "main", token: cfg.token.trim() });
    notify(`${label} saved`);
  };
  const toggleTheme = () => {
    setDark(!dark);
    try { localStorage.setItem("yoshi-theme", dark ? "light" : "dark"); } catch { /* ignore */ }
  };
  const toggleNotifications = async () => {
    if (!profile) return;
    const next = !profile.notifications_enabled;
    const { error } = await supabase.from("profiles").update({ notifications_enabled: next }).eq("id", profile.id);
    if (error) return notify(error.message);
    onProfile({ ...profile, notifications_enabled: next });
    notify(next ? "Notifications on" : "Notifications off");
  };

  return (
    <section className={`settings-page ${dark ? "" : "soft-theme"}`}>
      <div className="setting-row">
        <strong>Theme</strong>
        <button className="theme-choice" onClick={toggleTheme}>
          <img className={dark ? "chosen" : ""} src={`${assets}/c06b2.svg`} alt="Dark theme" />
          <img className={!dark ? "chosen" : ""} src={`${assets}/a896c.svg`} alt="Light theme" />
        </button>
      </div>
      {configured && (
        <div className="setting-row">
          <strong>Notifications</strong>
          <Toggle enabled={profile?.notifications_enabled ?? true} onClick={() => void toggleNotifications()} />
        </div>
      )}
      {(isAdmin || !configured) && (
        <>
          <div className="setting-row"><strong>Github Owner</strong><input value={cfg.owner} onChange={update("owner")} onBlur={save("Owner")} /></div>
          <div className="setting-row"><strong>Repository</strong><input value={cfg.repo} onChange={update("repo")} onBlur={save("Repository")} /></div>
          <div className="setting-row"><strong>Branch</strong><input value={cfg.branch} onChange={update("branch")} onBlur={save("Branch")} /></div>
          <div className="setting-row"><strong>Github Token</strong><input type="password" value={cfg.token} onChange={update("token")} onBlur={save("Token")} placeholder="Contents: Read and write" /></div>
        </>
      )}
      {configured && profile && (
        <>
          <div className="setting-row"><strong>Account</strong><span>Connected with GitHub as {profile.display_name} ({profile.role})</span></div>
          <div className="setting-row"><strong>Session</strong><ActionButton tone="red" onClick={() => void supabase.auth.signOut()}>Sign out</ActionButton></div>
        </>
      )}
    </section>
  );
}
