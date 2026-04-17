<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const categories = [
    { key: 'all',         label: '全て' },
    { key: 'important',   label: '重要' },
    { key: 'suspicious',  label: '⚠️ 疑惑' },
    { key: 'newsletter',  label: 'ニュース' },
    { key: 'notification',label: '通知' },
    { key: 'promotion',   label: '広告' },
    { key: 'social',      label: 'SNS' },
    { key: 'other',       label: 'その他' },
  ];

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1)   return 'たった今';
    if (min < 60)  return `${min}分前`;
    const h = Math.floor(min / 60);
    if (h < 24)    return `${h}時間前`;
    const d = Math.floor(h / 24);
    if (d < 7)     return `${d}日前`;
    return new Date(iso).toLocaleDateString('ja-JP');
  }

  function openMail(threadId: string) {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isIOS = /iPhone|iPad/i.test(navigator.userAgent);
    const webUrl = `https://mail.google.com/mail/u/0/#inbox/${threadId}`;

    if (isAndroid) {
      window.location.href = `intent://mail.google.com/mail/u/0/#inbox/${threadId}#Intent;scheme=https;package=com.google.android.gm;end`;
    } else if (isIOS) {
      window.location.href = `googlegmail://mail/u/0/#inbox/${threadId}`;
      setTimeout(() => { window.open(webUrl, '_blank'); }, 1500);
    } else {
      window.open(webUrl, '_blank');
    }
  }

  function groupByDate(mails: any[]): { label: string; items: any[] }[] {
    const groups: Map<string, any[]> = new Map();
    const today    = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

    for (const mail of mails) {
      const d = new Date(mail.processed_at); d.setHours(0,0,0,0);
      let label: string;
      if (d.getTime() === today.getTime())     label = '今日';
      else if (d.getTime() === yesterday.getTime()) label = '昨日';
      else label = d.toLocaleDateString('ja-JP');

      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(mail);
    }

    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  }

  const groups = $derived(groupByDate(data.mails));
</script>

<svelte:head>
  <title>Mailzen</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<div class="app">
  <header>
    <h1>Mailzen</h1>
  </header>

  <nav class="tabs">
    {#each categories as cat}
      <a
        href="?category={cat.key}"
        class:active={data.category === cat.key}
      >{cat.label}</a>
    {/each}
  </nav>

  <main>
    {#if data.mails.length === 0}
      <p class="empty">メールはありません</p>
    {:else}
      {#each groups as group}
        <div class="date-group">
          <div class="date-label">{group.label}</div>

          {#each group.items as mail}
            <div class="card" class:suspicious={mail.suspicious}>
              <div class="card-header">
                <span class="sender">
                  {#if mail.suspicious}⚠️{/if}
                  {mail.sender}
                </span>
                <span class="time">{relativeTime(mail.processed_at)}</span>
              </div>
              <div class="subject">{mail.subject}</div>
              <div class="summary">{mail.summary}</div>
              <div class="card-footer">
                <span class="badge badge-{mail.category}">{mail.category}</span>
                {#if mail.thread_id}
                  <button
                    onclick={() => openMail(mail.thread_id)}
                    class="open-link"
                  >開く ↗</button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </main>
</div>

<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .app {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    max-width: 640px;
    margin: 0 auto;
    background: #f5f5f5;
    min-height: 100vh;
  }

  header {
    background: #1a1a2e;
    color: #fff;
    padding: 16px 20px;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  header h1 {
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  .tabs {
    display: flex;
    overflow-x: auto;
    background: #fff;
    border-bottom: 1px solid #e0e0e0;
    scrollbar-width: none;
  }

  .tabs::-webkit-scrollbar { display: none; }

  .tabs a {
    flex-shrink: 0;
    padding: 12px 16px;
    font-size: 0.85rem;
    color: #666;
    text-decoration: none;
    border-bottom: 2px solid transparent;
    white-space: nowrap;
  }

  .tabs a.active {
    color: #1a1a2e;
    border-bottom-color: #1a1a2e;
    font-weight: 600;
  }

  main {
    padding: 12px;
  }

  .empty {
    text-align: center;
    color: #999;
    padding: 60px 0;
  }

  .date-group {
    margin-bottom: 8px;
  }

  .date-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: #888;
    padding: 8px 4px 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .card {
    background: #fff;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 8px;
    border-left: 3px solid transparent;
  }

  .card.suspicious {
    border-left-color: #e53e3e;
    background: #fff5f5;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .sender {
    font-weight: 600;
    font-size: 0.9rem;
    color: #1a1a2e;
  }

  .time {
    font-size: 0.75rem;
    color: #999;
    flex-shrink: 0;
    margin-left: 8px;
  }

  .subject {
    font-size: 0.85rem;
    color: #333;
    margin-bottom: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .summary {
    font-size: 0.82rem;
    color: #666;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .badge {
    font-size: 0.72rem;
    padding: 2px 8px;
    border-radius: 12px;
    background: #e8e8e8;
    color: #555;
  }

  .badge-important   { background: #ebf8ff; color: #2b6cb0; }
  .badge-suspicious  { background: #fff5f5; color: #c53030; }
  .badge-newsletter  { background: #f0fff4; color: #276749; }
  .badge-promotion   { background: #fffff0; color: #744210; }
  .badge-social      { background: #faf5ff; color: #553c9a; }
  .badge-notification{ background: #fff8f1; color: #7b341e; }

  .open-link {
    font-size: 0.78rem;
    color: #4a6fa5;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .open-link:hover { text-decoration: underline; }
</style>
