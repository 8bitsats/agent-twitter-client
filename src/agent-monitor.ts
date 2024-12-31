import { DataIndexer } from './data-indexer';
import { Scraper } from './scraper';
import { Tweet } from './tweets';

export class AgentMonitor {
  private readonly scraper: Scraper;
  private readonly dataIndexer: DataIndexer;
  private isMonitoring: boolean = false;
  private lastCheckedId: string | null = null;
  private readonly checkInterval: number = 30000; // Check every 30 seconds
  private intervalId: NodeJS.Timeout | null = null;
  private readonly targetUser: string = 'aixbt_agent';

  constructor(scraper: Scraper, dataIndexer: DataIndexer) {
    this.scraper = scraper;
    this.dataIndexer = dataIndexer;
  }

  public async start(): Promise<void> {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    console.log(`Started monitoring @${this.targetUser}'s tweets...`);
    
    // Initial check
    await this.checkNewTweets();
    
    // Set up periodic checking
    this.intervalId = setInterval(() => {
      this.checkNewTweets().catch(error => {
        console.error('Error checking new tweets:', error);
      });
    }, this.checkInterval);
  }

  public stop(): void {
    if (!this.isMonitoring) return;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isMonitoring = false;
    console.log(`Stopped monitoring @${this.targetUser}'s tweets.`);
  }

  private async checkNewTweets(): Promise<void> {
    try {
      const maxTweets = 10; // We only need to check recent tweets
      const tweets: Tweet[] = [];

      // Fetch recent tweets
      for await (const tweet of this.scraper.getTweets(this.targetUser, maxTweets)) {
        // Skip if we've already processed this tweet
        if (this.lastCheckedId && tweet.id! <= this.lastCheckedId) {
          continue;
        }

        tweets.push(tweet);
      }

      // Update last checked ID if we found any tweets
      if (tweets.length > 0) {
        this.lastCheckedId = tweets[0].id!;
      }

      // Process tweets in chronological order (oldest first)
      for (const tweet of tweets.reverse()) {
        await this.processTweet(tweet);
      }
    } catch (error) {
      console.error('Error checking tweets:', error);
    }
  }

  private async processTweet(tweet: Tweet): Promise<void> {
    try {
      // First, index the tweet for analysis
      await this.dataIndexer.indexTweet(tweet);

      // Check if we should reply
      if (await this.dataIndexer.shouldReplyToTweet(tweet)) {
        // Generate reply content based on tweet analysis
        const replyContent = await this.dataIndexer.generateReplyContent(tweet);

        // Send the reply
        await this.scraper.sendTweet(replyContent, tweet.id);
        console.log(`Replied to tweet ${tweet.id} with: ${replyContent}`);

        // Add delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`Error processing tweet ${tweet.id}:`, error);
    }
  }

  public async getLatestInteractions(): Promise<{
    tweet: Tweet;
    reply: string;
  }[]> {
    const maxTweets = 20;
    const interactions = [];
    
    for await (const tweet of this.scraper.getTweets(this.targetUser, maxTweets)) {
      const replyContent = await this.dataIndexer.generateReplyContent(tweet);
      interactions.push({
        tweet,
        reply: replyContent
      });
    }
    
    return interactions;
  }
}
