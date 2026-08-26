import { redirect } from 'next/navigation';

export default function LegacyOriginalInventoryPage() {
  redirect('/planowanie-zapotrzebowania?view=spis');
}
