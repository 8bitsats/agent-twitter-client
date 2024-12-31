import express from 'express';
import path from 'path';

import { Octokit } from '@octokit/rest';

import { DataIndexer } from '../data-indexer';
import { Scraper } from '../scraper';

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author?: {
      name?: string;
      date?: string;
    };
  };
}

export class DashboardServer {
  private readonly app: express.Application;
  private readonly port: number;
  private readonly dataIndexer: DataIndexer;
  private readonly scraper: Scraper;
  private readonly octokit: Octokit;

  constructor(port: number, dataIndexer: DataIndexer, scraper: Scraper) {
    this.port = port;
    this.dataIndexer = dataIndexer;
    this.scraper = scraper;
    this.app = express();
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  private setupRoutes(): void {
    // Serve dashboard UI
    this.app.get('/', (req: express.Request, res: express.Response) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // API endpoints
    this.app.get('/api/stats/:username', async (req: express.Request, res: express.Response) => {
      try {
        const stats = await this.dataIndexer.getEngagementStats(req.params.username);
        res.json(stats);
      } catch (error: unknown) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
      }
    });

    this.app.get('/api/topics/:username', async (req: express.Request, res: express.Response) => {
      try {
        const topics = await this.dataIndexer.getRelevantTopics(req.params.username);
        res.json(topics);
      } catch (error: unknown) {
        console.error('Error fetching topics:', error);
        res.status(500).json({ error: 'Failed to fetch topics' });
      }
    });

    this.app.get('/api/github/updates', async (req: express.Request, res: express.Response) => {
      try {
        const commits = await this.octokit.repos.listCommits({
          owner: 'cheshir',
          repo: 'CheshCasino',
          per_page: 5
        });

        const updates = commits.data.map((commit: GitHubCommit) => ({
          sha: commit.sha,
          message: commit.commit.message,
          date: commit.commit.author?.date,
          author: commit.commit.author?.name
        }));

        res.json(updates);
      } catch (error: unknown) {
        console.error('Error fetching GitHub updates:', error);
        res.status(500).json({ error: 'Failed to fetch GitHub updates' });
      }
    });

    this.app.get('/api/interactions', async (req: express.Request, res: express.Response) => {
      try {
        const tweets = await this.getTweetsWithInteractions();
        res.json(tweets);
      } catch (error: unknown) {
        console.error('Error fetching interactions:', error);
        res.status(500).json({ error: 'Failed to fetch interactions' });
      }
    });
  }

  private async getTweetsWithInteractions() {
    const maxTweets = 100;
    const tweets = [];
    
    for await (const tweet of this.scraper.getTweets('aixbt_agent', maxTweets)) {
      const shouldReply = await this.dataIndexer.shouldReplyToTweet(tweet);
      if (shouldReply) {
        const replyContent = await this.dataIndexer.generateReplyContent(tweet);
        tweets.push({
          id: tweet.id,
          text: tweet.text,
          replyContent,
          timestamp: tweet.timestamp
        });
      }
    }
    
    return tweets;
  }

  public start(): void {
    this.app.listen(this.port, () => {
      console.log(`Dashboard server running on port ${this.port}`);
    });
  }
}
