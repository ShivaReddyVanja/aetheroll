export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Is the photo and video storage really unlimited and free?",
    answer:
      "Yes, 100%! Unlike other cloud services that start charging you as soon as you hit 15 GB, Aetheroll connects directly to your private Telegram cloud storage. You can store tens of thousands of full-resolution photos and 4K videos with $0 monthly subscription fees.",
  },
  {
    question: "Does it compress my photos or reduce video quality?",
    answer:
      "No. Every photo and video is preserved in 100% original quality—including 48MP ProRAW photos, 4K HDR videos, and original camera settings (aperture, ISO, capture date, and GPS location).",
  },
  {
    question: "Can anyone else—or even Aetheroll—see my photos?",
    answer:
      "Never. Your files are stored in your own private cloud vault with client-side encryption. Nobody can view, scan, or analyze your memories. We do not run ads and we never use your personal photos to train AI models.",
  },
  {
    question: "How does automatic mobile backup work?",
    answer:
      "With the Android mobile app, you can turn on background camera roll backup. Any new photo or video you take will automatically sync to your private vault in full resolution without draining your battery.",
  },
  {
    question: "Can I watch 4K videos smoothly without buffering?",
    answer:
      "Yes! Our video streaming engine delivers instantaneous playback and seamless fast-forwarding or rewinding, so you don't have to wait for large multi-gigabyte video files to download before watching.",
  },
  {
    question: "Can I share full-quality albums with friends and family?",
    answer:
      "Yes! You can create simple, private share links for specific photos or entire albums. Your friends and family can view and download the full-resolution photos on any phone, tablet, or computer without needing an account.",
  },
];

