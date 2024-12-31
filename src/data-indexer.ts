import fs from 'fs';
import path from 'path';

import { Scraper } from './scraper';
import { Tweet } from './tweets';

interface IndexedTweet extends Tweet {
  sentiment?: number;
  topics?: string[];
  timestamp: number;
  isReply: boolean;
  replyToId?: string;
  replyToUser?: string;
  engagement: {
    likes: number;
    retweets: number;
    replies: number;
  };
}

interface AgentMemory {
  lastInteraction: number;
  interactions: {
    [key: string]: {
      count: number;
      lastTimestamp: number;
      topics: { [key: string]: number };
    };
  };
  topicHistory: { [key: string]: number };
}

export class DataIndexer {
  private readonly dataDir: string;
  private readonly scraper: Scraper;
  private memory: AgentMemory;
  private tweets: { [key: string]: IndexedTweet };

  constructor(scraper: Scraper) {
    this.scraper = scraper;
    this.dataDir = path.join(__dirname, '../data');
    this.tweets = {};
    this.memory = this.loadMemory();

    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadMemory(): AgentMemory {
    const memoryPath = path.join(this.dataDir, 'memory.json');
    if (fs.existsSync(memoryPath)) {
      return JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
    }
    return {
      lastInteraction: 0,
      interactions: {},
      topicHistory: {}
    };
  }

  private saveMemory(): void {
    const memoryPath = path.join(this.dataDir, 'memory.json');
    fs.writeFileSync(memoryPath, JSON.stringify(this.memory, null, 2));
  }

  private async analyzeTweet(tweet: Tweet): Promise<IndexedTweet> {
    // Basic sentiment analysis (can be enhanced with proper NLP)
    const sentiment = tweet.text?.toLowerCase().split(' ').reduce((acc, word) => {
      if (['great', 'good', 'excellent', 'bullish', 'up'].includes(word)) return acc + 0.1;
      if (['bad', 'poor', 'bearish', 'down'].includes(word)) return acc - 0.1;
      return acc;
    }, 0) || 0;

    // Extract topics (can be enhanced with proper topic modeling)
    const topics = tweet.text
      ?.toLowerCase()
      .match(/#\w+/g)
      ?.map(tag => tag.slice(1)) || [];

    return {
      ...tweet,
      sentiment,
      topics,
      timestamp: Date.now(),
      isReply: !!tweet.inReplyToStatusId,
      replyToId: tweet.inReplyToStatusId,
      replyToUser: tweet.username,
      engagement: {
        likes: tweet.likes || 0,
        retweets: tweet.retweets || 0,
        replies: 0 // Will be updated when indexing replies
      }
    };
  }

  public async indexTweet(tweet: Tweet): Promise<void> {
    const indexedTweet = await this.analyzeTweet(tweet);
    this.tweets[tweet.id!] = indexedTweet;

    // Update memory
    if (tweet.username) {
      if (!this.memory.interactions[tweet.username]) {
        this.memory.interactions[tweet.username] = {
          count: 0,
          lastTimestamp: 0,
          topics: {}
        };
      }

      const interaction = this.memory.interactions[tweet.username];
      interaction.count++;
      interaction.lastTimestamp = Date.now();

      // Update topic frequencies
      indexedTweet.topics?.forEach(topic => {
        interaction.topics[topic] = (interaction.topics[topic] || 0) + 1;
        this.memory.topicHistory[topic] = (this.memory.topicHistory[topic] || 0) + 1;
      });
    }

    this.saveMemory();
    this.saveTweets();
  }

  private saveTweets(): void {
    const tweetsPath = path.join(this.dataDir, 'tweets.json');
    fs.writeFileSync(tweetsPath, JSON.stringify(this.tweets, null, 2));
  }

  public async getRelevantTopics(username: string): Promise<string[]> {
    const interaction = this.memory.interactions[username];
    if (!interaction) return [];

    return Object.entries(interaction.topics)
      .sort((a, b) => b[1] - a[1])
      .map(([topic]) => topic)
      .slice(0, 5);
  }

  public async getEngagementStats(username: string): Promise<{
    avgLikes: number;
    avgRetweets: number;
    topTopics: string[];
  }> {
    const userTweets = Object.values(this.tweets).filter(t => t.username === username);
    if (userTweets.length === 0) return { avgLikes: 0, avgRetweets: 0, topTopics: [] };

    const avgLikes = userTweets.reduce((sum, t) => sum + t.engagement.likes, 0) / userTweets.length;
    const avgRetweets = userTweets.reduce((sum, t) => sum + t.engagement.retweets, 0) / userTweets.length;

    const topicCounts: { [key: string]: number } = {};
    userTweets.forEach(tweet => {
      tweet.topics?.forEach(topic => {
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
      });
    });

    const topTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([topic]) => topic)
      .slice(0, 5);

    return { avgLikes, avgRetweets, topTopics };
  }

  public async shouldReplyToTweet(tweet: Tweet): Promise<boolean> {
    // Check if it's from target user
    if (tweet.username !== 'aixbt_agent') return false;

    // Don't reply to replies
    if (tweet.inReplyToStatusId) return false;

    // Check if we've already replied
    const hasReplied = Object.values(this.tweets).some(
      t => t.username === process.env.TWITTER_USERNAME && t.replyToId === tweet.id
    );

    return !hasReplied;
  }

  public async generateReplyContent(tweet: Tweet): Promise<string> {
    const relevantTopics = await this.getRelevantTopics(tweet.username!);
    const stats = await this.getEngagementStats(tweet.username!);

    // Generate reply based on tweet content, relevant topics, and engagement stats
    let reply = '';

    // If tweet mentions specific topics we track
    if (tweet.text?.toLowerCase().includes('update') || tweet.text?.toLowerCase().includes('release')) {
      reply = "I'm tracking this update! Users can find more details in our latest GitHub commits. ";
    } else if (relevantTopics.some(topic => tweet.text?.toLowerCase().includes(topic))) {
      reply = `This aligns with our work on ${relevantTopics[0]}. `;
    } else {
      reply = "Interesting insight! ";
    }

    // Add engagement context
    if (stats.avgLikes > 100) {
      reply += "Your community engagement is impressive! ";
    }

    // Add relevant hashtags
    const hashtags = relevantTopics
      .slice(0, 2)
      .map(t => `#${t}`)
      .join(' ');
    reply += hashtags;

    return reply.trim();
  }
}
