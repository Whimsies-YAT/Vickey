# Smart Timeline System

## Overview

The Smart Timeline System provides an intelligent, non-chronological content feed that prioritizes relevance, engagement, and user preferences over simple time-based ordering. This system combines multiple recommendation algorithms to deliver a personalized content experience.

## Architecture

### Core Components

1. **SmartTimelineService** - Pure algorithmic timeline based on content scoring
2. **HybridTimelineService** - Intelligent mixing of chronological and smart content
3. **ContentRecommendationService** - Underlying recommendation engine
4. **UserProfileLearningService** - Continuous learning from user behavior

### Timeline Types

#### 1. Smart Timeline (`/api/notes/smart-timeline`)
- **Pure algorithmic approach** - No chronological ordering
- **Content scoring** based on multiple factors:
  - Freshness (configurable weight)
  - Engagement quality (reactions, replies, renotes)
  - Personal relevance (interaction history, topic preferences)
  - Author quality (reputation, account age)
- **Segment-based generation**:
  - Following content (40%)
  - Recommended content (35%)
  - Trending content (15%)
  - Discovery content (10%)

#### 2. Intelligent Timeline (`/api/notes/intelligent-timeline`)
- **Adaptive hybrid approach** - Automatically chooses best mode
- **Multiple modes**:
  - `auto` - System determines best approach
  - `chronological` - Traditional time-based ordering
  - `smart` - Pure algorithmic ordering
  - `mixed` - Configurable blend of both
- **User-adaptive** - Learns from user behavior and preferences

### Scoring Algorithm

```
Timeline Score = (Freshness × FreshnessWeight) + 
                (Engagement × 0.3) + 
                (PersonalRelevance × 0.25) + 
                (AuthorQuality × 0.15)
```

#### Scoring Factors

1. **Freshness Score** (0-1)
   - Exponential decay: `exp(-ageHours / 24)`
   - 24-hour half-life for content relevance
   - Configurable weight (default: 0.3)

2. **Engagement Score** (0-1)
   - Based on reactions, renotes, and replies
   - Weighted by content age (engagement rate per hour)
   - Logarithmic scaling to prevent outlier dominance

3. **Personal Relevance** (0-1)
   - Author interaction history (30-day window)
   - Topic preference matching (hashtags)
   - Content type preferences

4. **Author Quality** (0-1)
   - Follower/following ratio
   - Account age and reputation
   - Cached for performance (1-hour TTL)

### Adaptive Mode Selection

The system automatically determines the best timeline mode based on:

- **New users** (< 7 days): Smart timeline for discovery
- **Low following** (< 10): Mixed with high smart ratio (70%)
- **High exploration preference**: Mixed with smart bias (60%)
- **High following** (> 100): Mixed with chronological bias (70%)
- **Default**: Balanced mixed mode (50/50)

### Content Segmentation

#### Following Segment
- Content from users the person follows
- Time window: 24-72 hours (configurable)
- Respects user preferences (replies, renotes, files)
- Applies visibility and filtering rules

#### Recommended Segment
- Uses ContentRecommendationService
- Excludes followed users to avoid duplication
- High diversity factor (0.7)
- Quality threshold filtering (0.5)

#### Trending Segment
- High-engagement content from recent time window
- Minimum engagement threshold
- Sorted by engagement velocity
- Time window: 6-12 hours

#### Discovery Segment
- Content from unfollowed users
- Excludes muted/blocked users
- Random sampling with engagement filter
- Promotes content diversity

### Diversity and Quality Controls

#### Diversity Filtering
- **Author diversity**: Limits posts per author
- **Topic diversity**: Prevents hashtag clustering
- **Content type diversity**: Balances media/text/polls
- **Configurable levels**: Low, Medium, High

#### Quality Thresholds
- Minimum engagement requirements
- Author reputation filtering
- Content quality scoring
- Spam and low-quality detection

### Caching Strategy

#### Multi-Level Caching
1. **Timeline Cache** (10 minutes)
   - Complete timeline results
   - User-specific with parameter hashing

2. **Segment Cache** (5 minutes)
   - Individual segment results
   - Shared across similar requests

3. **Score Cache** (10 minutes)
   - Engagement and author scores
   - Reduces database load

4. **User Data Cache** (1 hour)
   - Following/muted/blocked lists
   - Social graph information

### API Endpoints

#### Timeline Endpoints
- `GET /api/notes/smart-timeline` - Pure algorithmic timeline
- `GET /api/notes/intelligent-timeline` - Adaptive hybrid timeline
- `POST /api/notes/timeline-refresh` - Clear timeline cache

#### Preference Endpoints
- `GET /api/i/timeline-preferences` - Get user preferences
- `POST /api/i/update-timeline-preferences` - Update preferences

#### Analytics Endpoints
- `GET /api/notes/timeline-stats` - Timeline performance metrics
- `GET /api/admin/recommendation-stats` - System-wide analytics

### Configuration Options

#### User-Configurable
- **Algorithm**: smart, hybrid, social, discovery
- **Diversity Level**: low, medium, high
- **Freshness Weight**: 0-1 (importance of recency)
- **Quality Threshold**: 0-1 (minimum content quality)
- **Smart Ratio**: 0-1 (smart vs chronological content)

#### System-Configurable
- Cache TTL values
- Segment weights and sizes
- Scoring factor weights
- Performance thresholds

### Performance Optimizations

#### Database Optimizations
- Efficient queries with proper indexing
- Pagination with ID-based cursors
- Batch processing for scoring
- Connection pooling

#### Algorithm Optimizations
- Parallel segment generation
- Cached score calculations
- Efficient deduplication
- Lazy loading for large datasets

#### Memory Management
- Redis-based caching
- Configurable cache sizes
- Automatic cache eviction
- Memory usage monitoring

### Privacy and Safety

#### Content Filtering
- Respects user muting and blocking
- Applies visibility rules
- Filters suspended/deleted users
- NSFW content handling

#### Data Protection
- No external API calls
- Local processing only
- Anonymized analytics
- Configurable data retention

### Monitoring and Analytics

#### Performance Metrics
- Cache hit rates
- Average response times
- Content diversity scores
- User engagement rates

#### Quality Metrics
- Recommendation accuracy
- User satisfaction indicators
- Content freshness distribution
- Algorithm effectiveness

### Future Enhancements

#### Planned Features
- Machine learning integration
- Real-time personalization
- Cross-platform synchronization
- Advanced NLP for content analysis

#### Research Areas
- Temporal pattern recognition
- Social influence modeling
- Content quality prediction
- Bias detection and mitigation

## Implementation Notes

### Dependencies
- ContentRecommendationService for algorithmic recommendations
- FanoutTimelineService for chronological content
- Redis for multi-level caching
- PostgreSQL for data persistence

### Deployment Considerations
- Requires adequate Redis memory for caching
- CPU-intensive scoring calculations
- Database optimization for large user bases
- Monitoring for performance degradation

### Maintenance
- Regular cache cleanup
- Performance metric monitoring
- Algorithm parameter tuning
- User feedback integration

This smart timeline system provides a sophisticated, user-centric approach to content discovery while maintaining high performance and respecting user preferences and privacy.
