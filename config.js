/**
 * AKS Newsletter Agent – Configuration
 * Source URLs and constants for content collection.
 */

const SOURCES = {
  aks_blog: {
    name: "AKS Engineering Blog",
    url: "https://blog.aks.azure.com/",
    mandatory: true,
    type: "blog",
  },
  azure_updates: {
    name: "Azure Updates (AKS)",
    url: "https://azure.microsoft.com/en-us/updates/?query=AKS",
    mandatory: true,
    type: "updates",
  },
  aks_releases: {
    name: "AKS GitHub Releases",
    url: "https://github.com/Azure/AKS/releases/",
    apiUrl: "https://api.github.com/repos/Azure/AKS/releases?per_page=30",
    mandatory: true,
    type: "github_releases",
  },
  aks_docs: {
    name: "AKS Documentation (Recent Commits)",
    url: "https://github.com/MicrosoftDocs/azure-aks-docs/tree/main/articles/aks",
    apiUrl: "https://api.github.com/repos/MicrosoftDocs/azure-aks-docs/commits?path=articles/aks&per_page=100",
    mandatory: true,
    type: "github_commits",
  },
  aks_roadmap: {
    name: "AKS Public Roadmap",
    url: "https://github.com/orgs/Azure/projects/685/views/1",
    mandatory: true,
    type: "roadmap",
  },
  techcommunity_aks: {
    name: "TechCommunity – AKS Posts",
    url: "https://techcommunity.microsoft.com/search?q=AKS&contentType=BLOG&sortBy=newest",
    mandatory: true,
    type: "techcommunity",
  },
  azure_architecture_blog: {
    name: "Azure Architecture Blog",
    url: "https://techcommunity.microsoft.com/t5/azure-architecture-blog/bg-p/AzureArchitectureBlog",
    mandatory: true,
    type: "techcommunity",
  },
  azure_infrastructure_blog: {
    name: "Azure Infrastructure Blog",
    url: "https://techcommunity.microsoft.com/t5/azure-infrastructure-blog/bg-p/AzureInfrastructureBlog",
    mandatory: true,
    type: "techcommunity",
  },
  linux_opensource_blog: {
    name: "Linux and Open Source Blog",
    url: "https://techcommunity.microsoft.com/t5/linux-and-open-source-blog/bg-p/LinuxAndOpenSourceBlog",
    mandatory: true,
    type: "techcommunity",
  },
  apps_on_azure_blog: {
    name: "Apps on Azure Blog",
    url: "https://techcommunity.microsoft.com/t5/apps-on-azure-blog/bg-p/AppsonAzureBlog",
    mandatory: true,
    type: "techcommunity",
  },
  azure_observability_blog: {
    name: "Azure Observability Blog",
    url: "https://techcommunity.microsoft.com/t5/azure-observability-blog/bg-p/AzureObservabilityBlog",
    mandatory: true,
    type: "techcommunity",
  },
  aks_youtube: {
    name: "AKS Community YouTube",
    url: "https://www.youtube.com/@theakscommunity/videos",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCWgpFvYA0JCI1ixOvv8q8EQ",
    mandatory: true,
    type: "youtube",
  },
  azure_youtube: {
    name: "Microsoft Azure YouTube",
    url: "https://www.youtube.com/@MicrosoftAzure/videos",
    feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UC0m-80FnNY2Qb7obvTL_2fA",
    mandatory: true,
    type: "youtube",
  },
};

const SECTION_HEADERS = {
  ga_announcements: "✅ General Availability Announcements",
  preview_announcements: "🧪 Preview Feature Announcements",
  behavioral_changes: "🔁 Behavioral Changes",
  documentation_updates: "🔎 Documentation Updates",
  community_blogs: "📚 Community Blogs",
  releases_roadmap: "🔗 Releases and Roadmap",
  watch_learn: "🎥 Watch & Learn",
  closing_thoughts: "🧠 Closing Thoughts",
};

const AKS_KEYWORDS = [
  "aks",
  "kubernetes",
  "k8s",
  "container",
  "helm",
  "istio",
  "cilium",
  "kube",
  "node pool",
  "kubectl",
];

// Stricter keywords for filtering community blogs — avoids false positives
// from "container apps", "container registry", etc.
const AKS_STRICT_KEYWORDS = [
  "aks",
  "azure kubernetes",
  "k8s",
  "node pool",
  "kubectl",
  "kubelet",
  "kube-proxy",
  "cilium",
  "istio",
  "helm",
  "karpenter",
  "kaito",
];

module.exports = { SOURCES, SECTION_HEADERS, AKS_KEYWORDS, AKS_STRICT_KEYWORDS };
