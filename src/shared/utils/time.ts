export function formatRelativeTime(dateLike: Date | string): string {
  const date = typeof dateLike === 'string' ? new Date(dateLike) : dateLike;
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Şimdi';
  if (minutes < 60) return `${minutes} dk`;
  if (hours < 24) return `${hours} sa`;
  if (days < 7) return `${days} g`;

  return date.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
  });
}

export function formatChatTimestamp(dateLike: Date | string): string {
  const date = typeof dateLike === 'string' ? new Date(dateLike) : dateLike;

  if (Number.isNaN(date.getTime())) {
    return '--.--.-- --:--';
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${day}.${month}.${year} ${hours}:${minutes}`;
}
