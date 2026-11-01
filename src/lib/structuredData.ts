import type { FaqItem } from '../content/content';
import { SITE_NAME, SITE_ORIGIN, canonicalUrl, pageMetaFor } from './pageMeta';

/**
 * schema.org JSON-LD for each prerendered page. Facts here must match docs/GROWTH_PLAN.md
 * section 3 (fact sheet).
 */

const ORG_ID = `${SITE_ORIGIN}/#organization`;
const WEBSITE_ID = `${SITE_ORIGIN}/#website`;

const ORGANIZATION = {
  '@type': ['Organization', 'NGO'],
  '@id': ORG_ID,
  name: 'Vanik Council (UK)',
  alternateName: 'The National Council of Vanik Associations (UK)',
  url: SITE_ORIGIN + '/',
  email: 'matrimonial@vanikcouncil.uk',
  logo: `${SITE_ORIGIN}/favicon.svg`,
  foundingDate: '1978',
  identifier: {
    '@type': 'PropertyValue',
    propertyID: 'Charity Commission for England and Wales registered charity number',
    value: '1137083',
  },
  sameAs: ['https://www.vanikcouncil.uk/'],
  description:
    'Vanik Council (UK) is a registered charity founded in 1978 and an umbrella organisation for Vanik associations across the UK. Its volunteers run the Vanik Matrimonial Register, a not-for-profit matrimonial introduction service for Gujarati Hindu and Jain families that has run for over 40 years.',
  areaServed: { '@type': 'Country', name: 'United Kingdom' },
};

const WEBSITE = {
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  url: SITE_ORIGIN + '/',
  name: SITE_NAME,
  publisher: { '@id': ORG_ID },
  inLanguage: 'en-GB',
};

const SERVICE = {
  '@type': 'Service',
  '@id': `${SITE_ORIGIN}/#service`,
  name: SITE_NAME,
  serviceType: 'Matrimonial introduction service',
  provider: { '@id': ORG_ID },
  areaServed: { '@type': 'Country', name: 'United Kingdom' },
  audience: {
    '@type': 'Audience',
    audienceType: 'Gujarati Hindu and Jain singles and families seeking marriage introductions',
  },
  description:
    'A private matrimonial introduction service for Gujarati Hindu and Jain families. Every profile is verified by volunteers before it appears, contact details are only shared inside the member dashboard on request, and names, photos and contact details are never displayed publicly. The service is not-for-profit, shows no advertising and does not sell data.',
  offers: {
    '@type': 'Offer',
    name: 'Annual membership',
    price: '10.00',
    priceCurrency: 'GBP',
    url: `${SITE_ORIGIN}/register`,
    description: 'Annual membership of the Vanik Matrimonial Register, payable by card when you register.',
  },
};

/** Mirrors the FAQ section on the homepage (src/pages/Landing.tsx). */
const HOME_FAQ: FaqItem[] = [
  {
    question: 'Who can join the Vanik Matrimonial Register?',
    answer:
      'Membership is open to adults aged 18 and over from Gujarati Hindu and Jain families. The register is run by Vanik Council volunteers in the UK and has helped families find respectful introductions for over 40 years.',
  },
  {
    question: "I'm a parent. Can I register on behalf of my son or daughter?",
    answer:
      "We love that parents want to help: many happy matches in our community started exactly that way. The account itself, though, should be created by the person looking to marry: they are the one who will browse profiles, receive introductions and speak with matches, and we verify each member's own identity. The best way to help is to share the register with them and encourage them to register.",
  },
  {
    question: 'How much does membership cost?',
    answer:
      'Annual membership is £10, payable by card when you register. The register is a not-for-profit service run by the community, for the community. There is no advertising and data is never sold.',
  },
  {
    question: 'How long does it take to be approved?',
    answer:
      'Every application is reviewed by the volunteer team, including proof of identity, within 2 working days. Once approved you can browse verified profiles and request introductions from your dashboard.',
  },
  {
    question: 'Is my information kept private?',
    answer:
      'Yes. Contact details are shared only inside your member dashboard when you ask for them, and nothing is ever displayed publicly. Every profile is verified before it appears, and the service does not sell data or show advertising.',
  },
  {
    question: 'How do introductions work?',
    answer:
      'Once approved, you browse verified profiles and save anyone you would like to know more about. You can then request contact details and view them in your dashboard, up to three at a time, with fair weekly and monthly limits to keep things balanced.',
  },
  {
    question: 'Can I see profiles before registering?',
    answer:
      'Yes. You can browse a preview of profiles at matrimonial.vanikcouncil.uk/demo before you decide to register. Full profiles, saved lists and contact requests are available to approved members.',
  },
];

function faqPage(pathname: string, items: FaqItem[]) {
  return {
    '@type': 'FAQPage',
    '@id': `${canonicalUrl(pathname)}#faq`,
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.question,
      acceptedAnswer: { '@type': 'Answer', text: i.answer },
    })),
  };
}

function breadcrumbs(trail: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: canonicalUrl(t.path),
    })),
  };
}

export function structuredDataFor(pathname: string): Record<string, unknown> {
  const meta = pageMetaFor(pathname);
  const graph: Record<string, unknown>[] = [ORGANIZATION, WEBSITE];
  const entry = meta?.content;

  if (pathname === '/') {
    graph.push(SERVICE, faqPage('/', HOME_FAQ));
  } else if (entry?.kind === 'guide') {
    graph.push(
      {
        '@type': 'Article',
        '@id': `${canonicalUrl(pathname)}#article`,
        headline: entry.heading,
        description: entry.description,
        dateModified: entry.updated || undefined,
        datePublished: entry.updated || undefined,
        inLanguage: 'en-GB',
        author: { '@id': ORG_ID },
        publisher: { '@id': ORG_ID },
        mainEntityOfPage: canonicalUrl(pathname),
        isPartOf: { '@id': WEBSITE_ID },
      },
      breadcrumbs([
        { name: 'Home', path: '/' },
        { name: 'Guides', path: '/guides' },
        { name: entry.heading, path: pathname },
      ])
    );
  } else if (meta) {
    const name = entry?.heading ?? meta.title.replace(` - ${SITE_NAME}`, '');
    graph.push(
      {
        '@type': pathname === '/about' ? 'AboutPage' : 'WebPage',
        '@id': canonicalUrl(pathname),
        url: canonicalUrl(pathname),
        name,
        description: meta.description,
        dateModified: meta.updated,
        inLanguage: 'en-GB',
        isPartOf: { '@id': WEBSITE_ID },
        about: { '@id': ORG_ID },
      },
      breadcrumbs([
        { name: 'Home', path: '/' },
        { name, path: pathname },
      ])
    );
    if (entry && entry.faq.length >= 3) graph.push(faqPage(pathname, entry.faq));
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}
