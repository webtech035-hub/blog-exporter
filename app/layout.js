import './globals.css';

export const metadata = {
  title: 'Blog Crawler & Exporter',
  description: 'Crawl blog posts from any website and export them for WordPress, Wix, Squarespace, Shopify, Webflow and more.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
