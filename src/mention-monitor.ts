import fs from 'fs';

import { ArtGenerator } from './art-generator';
import { Scraper } from './scraper';
import { Tweet } from './tweets';

export class MentionMonitor {
  private readonly scraper: Scraper;
  private readonly artGenerator: ArtGenerator;
  private isMonitoring: boolean = false;
  private lastCheckedId: string | null = null;
  private readonly checkInterval: number = 60000; // Check every minute
  private intervalId: NodeJS.Timeout | null = null;

  constructor(scraper: Scraper, artGenerator: ArtGenerator) {
    this.scraper = scraper;
    this.artGenerator = artGenerator;
  }

  async start() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    console.log('Started monitoring mentions...');
    
    // Initial check
    await this.checkMentions();
    
    // Set up periodic checking
    this.intervalId = setInterval(() => {
      this.checkMentions().catch(console.error);
    }, this.checkInterval);
  }

  stop() {
    if (!this.isMonitoring) return;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isMonitoring = false;
    console.log('Stopped monitoring mentions.');
  }

  private async checkMentions() {
    try {
      const maxTweets = 20;
      const mentions: Tweet[] = [];
      const query = `@${process.env.TWITTER_USERNAME} #generateart`;
      const searchMode = 1; // SearchMode.Latest

      // Fetch recent mentions with #generateart hashtag
      for await (const tweet of this.scraper.searchTweets(query, maxTweets, searchMode)) {
        // Skip if we've already processed this tweet
        if (this.lastCheckedId && tweet.id! <= this.lastCheckedId) {
          continue;
        }

        // Skip own tweets
        if (tweet.username !== process.env.TWITTER_USERNAME) {
          mentions.push(tweet);
        }
      }

      // Update last checked ID if we found any mentions
      if (mentions.length > 0) {
        this.lastCheckedId = mentions[0].id!;
      }

      // Process mentions in chronological order (oldest first)
      for (const mention of mentions.reverse()) {
        await this.processMention(mention);
      }
    } catch (error) {
      console.error('Error checking mentions:', error);
    }
  }

  private async processMention(mention: Tweet) {
    try {
      // Extract the art prompt - everything after #generateart
      if (!mention.text) return;
      const promptMatch = mention.text.match(/#generateart\s+(.+)$/i);
      if (!promptMatch) return;

      const prompt = promptMatch[1].trim();
      console.log(`Generating art for @${mention.username} with prompt: ${prompt}`);

      // Generate the art
      const imagePath = await this.artGenerator.generateArt(prompt);

      // Reply with the generated image
      const replyText = `@${mention.username} Here's your generated art! 🎨`;
      await this.scraper.sendTweet(replyText, mention.id, [{
        data: await fs.promises.readFile(imagePath),
        mediaType: 'image/png'
      }]);

      console.log(`Replied to @${mention.username} with generated art`);
    } catch (error) {
      console.error('Error processing mention:', error);
      
      // Send error message to user
      const errorText = `@${mention.username} Sorry, I encountered an error while generating your art. Please try again later.`;
      await this.scraper.sendTweet(errorText, mention.id);
    }
  }
}
